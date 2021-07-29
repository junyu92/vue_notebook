# Kernel Address Space Layout Randomization

With kernel address space layout randomization (KASLR), the kernel
is loaded to a random location in memory.

Loading the kernel to a random location can protect against attacks
that rely on knowledge of the kernel addresses.

## KASLR on ARM64

```
__primary_switch:

// ...

#ifdef CONFIG_RANDOMIZE_BASE
        ldr     x8, =__primary_switched
        adrp    x0, __PHYS_OFFSET
        blr     x8

```

`__primary_switch` invokes `__primary_switched`

```
__primary_switched::

// ...

#ifdef CONFIG_RANDOMIZE_BASE
        tst     x23, ~(MIN_KIMG_ALIGN - 1)      // already running randomized?
        b.ne    0f
        mov     x0, x21                         // pass FDT address in x0
        bl      kaslr_early_init                // parse FDT for KASLR options
```

`primary_switched` invokes `kaslr_early_init` which fetchs `kaslr_seed`
from dtb.

```c
u64 __init kaslr_early_init(u64 dt_phys)
{
        void *fdt;
        u64 seed, offset, mask, module_range;
        const u8 *cmdline, *str;
        int size;

        /*
         * Set a reasonable default for module_alloc_base in case
         * we end up running with module randomization disabled.
         */
        module_alloc_base = (u64)_etext - MODULES_VSIZE;
        __flush_dcache_area(&module_alloc_base, sizeof(module_alloc_base));

        /*
         * Try to map the FDT early. If this fails, we simply bail,
         * and proceed with KASLR disabled. We will make another
         * attempt at mapping the FDT in setup_machine()
         */
        early_fixmap_init();
        fdt = fixmap_remap_fdt(dt_phys, &size, PAGE_KERNEL);
        if (!fdt)
                return 0;

        /*
         * Retrieve (and wipe) the seed from the FDT
         */
        seed = get_kaslr_seed(fdt);
        if (!seed)
                return 0;

        /*
         * Check if 'nokaslr' appears on the command line, and
         * return 0 if that is the case.
         */
        cmdline = kaslr_get_cmdline(fdt);
        str = strstr(cmdline, "nokaslr");
        if (str == cmdline || (str > cmdline && *(str - 1) == ' '))
                return 0;

        /*
         * OK, so we are proceeding with KASLR enabled. Calculate a suitable
         * kernel image offset from the seed. Let's place the kernel in the
         * middle half of the VMALLOC area (VA_BITS_MIN - 2), and stay clear of
         * the lower and upper quarters to avoid colliding with other
         * allocations.
         * Even if we could randomize at page granularity for 16k and 64k pages,
         * let's always round to 2 MB so we don't interfere with the ability to
         * map using contiguous PTEs
         */
        mask = ((1UL << (VA_BITS_MIN - 2)) - 1) & ~(SZ_2M - 1);
        offset = BIT(VA_BITS_MIN - 3) + (seed & mask);

        /* use the top 16 bits to randomize the linear region */
        memstart_offset_seed = seed >> 48;

        if (IS_ENABLED(CONFIG_KASAN))
                /*
                 * KASAN does not expect the module region to intersect the
                 * vmalloc region, since shadow memory is allocated for each
                 * module at load time, whereas the vmalloc region is shadowed
                 * by KASAN zero pages. So keep modules out of the vmalloc
                 * region if KASAN is enabled, and put the kernel well within
                 * 4 GB of the module region.
                 */
                return offset % SZ_2G;

        if (IS_ENABLED(CONFIG_RANDOMIZE_MODULE_REGION_FULL)) {
                /*
                 * Randomize the module region over a 2 GB window covering the
                 * kernel. This reduces the risk of modules leaking information
                 * about the address of the kernel itself, but results in
                 * branches between modules and the core kernel that are
                 * resolved via PLTs. (Branches between modules will be
                 * resolved normally.)
                 */
                module_range = SZ_2G - (u64)(_end - _stext);
                module_alloc_base = max((u64)_end + offset - SZ_2G,
                                        (u64)MODULES_VADDR);
        } else {
                /*
                 * Randomize the module region by setting module_alloc_base to
                 * a PAGE_SIZE multiple in the range [_etext - MODULES_VSIZE,
                 * _stext) . This guarantees that the resulting region still
                 * covers [_stext, _etext], and that all relative branches can
                 * be resolved without veneers.
                 */
                module_range = MODULES_VSIZE - (u64)(_etext - _stext);
                module_alloc_base = (u64)_etext + offset - MODULES_VSIZE;
        }

        /* use the lower 21 bits to randomize the base of the module region */
        module_alloc_base += (module_range * (seed & ((1 << 21) - 1))) >> 21;
        module_alloc_base &= PAGE_MASK;

        __flush_dcache_area(&module_alloc_base, sizeof(module_alloc_base));
        __flush_dcache_area(&memstart_offset_seed, sizeof(memstart_offset_seed));

        return offset;
}
```

`kaslr_early_init` returns 0 means kaslr is disabled, call `start_kernel`.
otherwise, return to `_primary_switch`.

```
        cbz     x0, 0f                          // KASLR disabled? just proceed
        orr     x23, x23, x0                    // record KASLR offset
        ldp     x29, x30, [sp], #16             // we must enable KASLR, return
        ret                                     // to __primary_switch()
0:
#endif
        add     sp, sp, #16
        mov     x29, #0
        mov     x30, #0
        b       start_kernel
ENDPROC(__primary_switched)
```

Now `x23` contains the offset of kaslr, invoke `__create_page_tables` to recreate kernel
page table.

```
        /*
         * If we return here, we have a KASLR displacement in x23 which we need
         * to take into account by discarding the current kernel mapping and
         * creating a new one.
         */
        pre_disable_mmu_workaround
        msr     sctlr_el1, x20                  // disable the MMU
        isb
        bl      __create_page_tables            // recreate kernel mapping

        tlbi    vmalle1                         // Remove any stale TLB entries
        dsb     nsh

        msr     sctlr_el1, x19                  // re-enable the MMU
        isb
        ic      iallu                           // flush instructions fetched
        dsb     nsh                             // via old mapping
        isb

        bl      __relocate_kernel
#endif

// ...
```