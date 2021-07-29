# Kernel entry point

## stext

```c
ENTRY(stext)
        bl      preserve_boot_args
        bl      el2_setup                       // Drop to EL1, w0=cpu_boot_mode
        adrp    x23, __PHYS_OFFSET
        and     x23, x23, MIN_KIMG_ALIGN - 1    // KASLR offset, defaults to 0
        bl      set_cpu_boot_mode_flag
        bl      __create_page_tables
        /*
         * The following calls CPU setup code, see arch/arm64/mm/proc.S for
         * details.
         * On return, the CPU will be ready for the MMU to be turned on and
         * the TCR will have been set.
         */
        bl      __cpu_setup                     // initialise processor
        b       __primary_switch
ENDPROC(stext)
```

## el2_setup

read `CurrentEL` register to find out the current exception level.

```c
ENTRY(el2_setup)
        msr     SPsel, #1                       // We want to use SP_EL{1,2}
        mrs     x0, CurrentEL
        cmp     x0, #CurrentEL_EL2
```

If it is booting in EL1, setup `sctlr_el1` register and return.

```c
#define SCTLR_EL1_RES1  ((_BITUL(11)) | (_BITUL(20)) | (_BITUL(22)) | (_BITUL(28)) | \
                         (_BITUL(29)))
```

```c
        b.eq    1f
        mov_q   x0, (SCTLR_EL1_RES1 | ENDIAN_SET_EL1)
        msr     sctlr_el1, x0
        mov     w0, #BOOT_CPU_MODE_EL1          // This cpu booted in EL1
        isb
        ret
```

If it is booting in EL2. setup `sctlr_el2`.

```c
1:      mov_q   x0, (SCTLR_EL2_RES1 | ENDIAN_SET_EL2)
        msr     sctlr_el2, x0
```

Read bits[11:8] of `id_aa64mmfr1_el1` register to find out whether the
processor supports VHE.

```c
#ifdef CONFIG_ARM64_VHE
        /*
         * Check for VHE being present. For the rest of the EL2 setup,
         * x2 being non-zero indicates that we do have VHE, and that the
         * kernel is intended to run at EL2.
         */
        mrs     x2, id_aa64mmfr1_el1
        ubfx    x2, x2, #ID_AA64MMFR1_VHE_SHIFT, #4
#else
        mov     x2, xzr
#endif
```

If the processor supports VHE, write `hcr_el2` to `HCR_HOST_VHE_FLAGS`,
otherwise `HCR_HOST_NVHE_FLAGS`.

```c
// Trap General Exceptions
#define HCR_TGE         (UL(1) << 27)

// The Execution state for EL1 is AArch64
#define HCR_RW_SHIFT    31
#define HCR_RW          (UL(1) << HCR_RW_SHIFT)

// EL2 Host. Enables a configuration where a Host Operating
// System is running in EL2, and the Host Operating System's
// applications are running in EL0.
#define HCR_E2H         (UL(1) << 34)

#define HCR_HOST_VHE_FLAGS (HCR_RW | HCR_TGE | HCR_E2H)
```

```c
        /* Hyp configuration. */
        mov_q   x0, HCR_HOST_NVHE_FLAGS
        cbz     x2, set_hcr
        mov_q   x0, HCR_HOST_VHE_FLAGS
set_hcr:
        msr     hcr_el2, x0
        isb
```

If NVHE is enabled, setup `cnthctl_el2` register so that accessing physical timer
and counter is allowed.

```c
        /*
         * Allow Non-secure EL1 and EL0 to access physical timer and counter.
         * This is not necessary for VHE, since the host kernel runs in EL2,
         * and EL0 accesses are configured in the later stage of boot process.
         * Note that when HCR_EL2.E2H == 1, CNTHCTL_EL2 has the same bit layout
         * as CNTKCTL_EL1, and CNTKCTL_EL1 accessing instructions are redefined
         * to access CNTHCTL_EL2. This allows the kernel designed to run at EL1
         * to transparently mess with the EL0 bits via CNTKCTL_EL1 access in
         * EL2.
         */
        cbnz    x2, 1f
        mrs     x0, cnthctl_el2
        orr     x0, x0, #3                      // Enable EL1 physical timers
        msr     cnthctl_el2, x0
1:
```

```c
        msr     cntvoff_el2, xzr                // Clear virtual offset
```

Read bits[24:4] of `id_aa64pfr0_el1` register.

Value 0 means *GIC CPU interface system registers not implemented*, jump to `3f`.

Value not 0 means
*System register interface to versions 3.0, 4.0 or 4.1 of the GIC CPU interface is supported*.
In this case, setup `SYS_ICC_SRE_EL2`.

* `ICC_SRE_EL2_ENABLE`: EL1 accesses to `ICC_SRE_EL1` do not trap to EL2.
* `ICC_SRE_EL2_SRE`: The System register interface to the ICH_* registers and
                     the EL1 and EL2 ICC_* registers is enabled for EL2.

```c
#ifdef CONFIG_ARM_GIC_V3
        /* GICv3 system register access */
        mrs     x0, id_aa64pfr0_el1
        ubfx    x0, x0, #ID_AA64PFR0_GIC_SHIFT, #4
        cbz     x0, 3f

        mrs_s   x0, SYS_ICC_SRE_EL2
        orr     x0, x0, #ICC_SRE_EL2_SRE        // Set ICC_SRE_EL2.SRE==1
        orr     x0, x0, #ICC_SRE_EL2_ENABLE     // Set ICC_SRE_EL2.Enable==1
        msr_s   SYS_ICC_SRE_EL2, x0
        isb                                     // Make sure SRE is now set
```

Double check, if failed to set `SYS_ICC_SRE_EL2`, reset `SYS_ICH_HCR_EL2`.

```c
        mrs_s   x0, SYS_ICC_SRE_EL2             // Read SRE back,
        tbz     x0, #0, 3f                      // and check that it sticks
        msr_s   SYS_ICH_HCR_EL2, xzr            // Reset ICC_HCR_EL2 to defaults

3:
#endif
```

Read `midr_el1` register which provides identification information for the PE,
including an implementer code for the device and a device ID number.

Read `mpidr_el1` which provides an additional PE identification mechanism for
scheduling purposes.

These are useful, see `__sysreg_save_el1_state` for more details.

```c
        /* Populate ID registers. */
        mrs     x0, midr_el1
        mrs     x1, mpidr_el1
        msr     vpidr_el2, x0
        msr     vmpidr_el2, x1
```

```c
#ifdef CONFIG_COMPAT
        msr     hstr_el2, xzr                   // Disable CP15 traps to EL2
#endif
```

Read bits[11:8] of `id_aa64dfr0_el1` register to get the version of pmu.
Read bits[35:32] of `id_aa64dfr0_el1` register to get the version of
Statistical Profiling Extension.

```c
        /* EL2 debug */
        mrs     x1, id_aa64dfr0_el1
        sbfx    x0, x1, #ID_AA64DFR0_PMUVER_SHIFT, #4
        cmp     x0, #1
        b.lt    4f                              // Skip if no PMU present
        mrs     x0, pmcr_el0                    // Disable debug access traps
        ubfx    x0, x0, #11, #5                 // to EL2 and allow access to
4:
        csel    x3, xzr, x0, lt                 // all PMU counters from EL1

        /* Statistical profiling */
        ubfx    x0, x1, #ID_AA64DFR0_PMSVER_SHIFT, #4
        cbz     x0, 7f                          // Skip if SPE not present
        cbnz    x2, 6f                          // VHE?
        mrs_s   x4, SYS_PMBIDR_EL1              // If SPE available at EL2,
        and     x4, x4, #(1 << SYS_PMBIDR_EL1_P_SHIFT)
        cbnz    x4, 5f                          // then permit sampling of physical
        mov     x4, #(1 << SYS_PMSCR_EL2_PCT_SHIFT | \
                      1 << SYS_PMSCR_EL2_PA_SHIFT)
        msr_s   SYS_PMSCR_EL2, x4               // addresses and physical counter
5:
        mov     x1, #(MDCR_EL2_E2PB_MASK << MDCR_EL2_E2PB_SHIFT)
        orr     x3, x3, x1                      // If we don't have VHE, then
        b       7f                              // use EL1&0 translation.
6:                                              // For VHE, use EL2 translation
        orr     x3, x3, #MDCR_EL2_TPMS          // and disable access from EL1
7:
        msr     mdcr_el2, x3                    // Configure debug traps
```c

Read bits[19:16] of `id_aa64mmfr1_el1` register which indicates support
for LORegions.

```c
        /* LORegions */
        mrs     x1, id_aa64mmfr1_el1
        ubfx    x0, x1, #ID_AA64MMFR1_LOR_SHIFT, 4
        cbz     x0, 1f
        msr_s   SYS_LORC_EL1, xzr
1:
```

Clear `vttbr_el2` register.

```c
        /* Stage-2 translation */
        msr     vttbr_el2, xzr
```

If NVHE is enabled, early init EL2. otherwise we directly return.
See the following comment for more details.

::: danger
If VHE is enabled, the last instruction is `ret`; otherwise `eret`.
:::

```c
        cbz     x2, install_el2_stub

        mov     w0, #BOOT_CPU_MODE_EL2          // This CPU booted in EL2
        isb
        ret
```

```c
install_el2_stub:
        /*
         * When VHE is not in use, early init of EL2 and EL1 needs to be
         * done here.
         * When VHE _is_ in use, EL1 will not be used in the host and
         * requires no configuration, and all non-hyp-specific EL2 setup
         * will be done via the _EL1 system register aliases in __cpu_setup.
         */
        mov_q   x0, (SCTLR_EL1_RES1 | ENDIAN_SET_EL1)
        msr     sctlr_el1, x0

        /* Coprocessor traps. */
        mov     x0, #0x33ff
        msr     cptr_el2, x0                    // Disable copro. traps to EL2

        /* SVE register access */
        mrs     x1, id_aa64pfr0_el1
        ubfx    x1, x1, #ID_AA64PFR0_SVE_SHIFT, #4
        cbz     x1, 7f

        bic     x0, x0, #CPTR_EL2_TZ            // Also disable SVE traps
        msr     cptr_el2, x0                    // Disable copro. traps to EL2
        isb
        mov     x1, #ZCR_ELx_LEN_MASK           // SVE: Enable full vector
        msr_s   SYS_ZCR_EL2, x1                 // length for EL1.

        /* Hypervisor stub */
7:      adr_l   x0, __hyp_stub_vectors
        msr     vbar_el2, x0

        /* spsr */
        mov     x0, #(PSR_F_BIT | PSR_I_BIT | PSR_A_BIT | PSR_D_BIT |\
                      PSR_MODE_EL1h)
        msr     spsr_el2, x0
        msr     elr_el2, lr
        mov     w0, #BOOT_CPU_MODE_EL2          // This CPU booted in EL2
        eret
ENDPROC(el2_setup)
```


## __cpu_setup

```c
ENTRY(__cpu_setup)
        tlbi    vmalle1                         // Invalidate local TLB
        dsb     nsh
```

Dont trap accessing the Advanced SIMD and floating-point registers.

```c
        mov     x0, #3 << 20
        msr     cpacr_el1, x0                   // Enable FP/ASIMD
```

EL0 accesses to the AArch64 DCC registers are trapped.

```c
        mov     x0, #1 << 12                    // Reset mdscr_el1 and disable
        msr     mdscr_el1, x0                   // access to the DCC from EL0
```

```c
        isb                                     // Unmask debug exceptions now,
        enable_dbg                              // since this is per-cpu
        reset_pmuserenr_el0 x0                  // Disable PMU access from EL0
```

`mair_el1` provides the memory attribute encodings corresponding to the possible
AttrIndx values in a Long-descriptor format translation table entry for stage 1
translations at EL1.

```c
        /*
         * Memory region attributes for LPAE:
         *
         *   n = AttrIndx[2:0]
         *                      n       MAIR
         *   DEVICE_nGnRnE      000     00000000
         *   DEVICE_nGnRE       001     00000100
         *   DEVICE_GRE         010     00001100
         *   NORMAL_NC          011     01000100
         *   NORMAL             100     11111111
         *   NORMAL_WT          101     10111011
         */
        ldr     x5, =MAIR(0x00, MT_DEVICE_nGnRnE) | \
                     MAIR(0x04, MT_DEVICE_nGnRE) | \
                     MAIR(0x0c, MT_DEVICE_GRE) | \
                     MAIR(0x44, MT_NORMAL_NC) | \
                     MAIR(0xff, MT_NORMAL) | \
                     MAIR(0xbb, MT_NORMAL_WT)
        msr     mair_el1, x5
```

```c
        /*
         * Prepare SCTLR
         */
        mov_q   x0, SCTLR_EL1_SET
```

setup `tcr_el1` which is the control register for stage 1 of the EL1&0
translation regime.

```c
        /*
         * Set/prepare TCR and TTBR. We use 512GB (39-bit) address range for
         * both user and kernel.
         */
        ldr     x10, =TCR_TxSZ(VA_BITS) | TCR_CACHE_FLAGS | TCR_SMP_FLAGS | \
                        TCR_TG_FLAGS | TCR_KASLR_FLAGS | TCR_ASID16 | \
                        TCR_TBI0 | TCR_A1 | TCR_KASAN_FLAGS

#ifdef CONFIG_ARM64_USER_VA_BITS_52
        ldr_l           x9, vabits_user
        sub             x9, xzr, x9
        add             x9, x9, #64
#else
        ldr_l           x9, idmap_t0sz
#endif
        tcr_set_t0sz    x10, x9

        /*
         * Set the IPS bits in TCR_EL1.
         */
        tcr_compute_pa_size x10, #TCR_IPS_SHIFT, x5, x6
#ifdef CONFIG_ARM64_HW_AFDBM
        /*
         * Enable hardware update of the Access Flags bit.
         * Hardware dirty bit management is enabled later,
         * via capabilities.
         */
        mrs     x9, ID_AA64MMFR1_EL1
        and     x9, x9, #0xf
        cbz     x9, 1f
        orr     x10, x10, #TCR_HA               // hardware Access flag update
1:
#endif  /* CONFIG_ARM64_HW_AFDBM */
        msr     tcr_el1, x10
        ret                                     // return to head.S
ENDPROC(__cpu_setup)
```

## create page tables

`__create_page_tables` creates initial page tables.

There are many kinds of page tables:

* `idmap_pg_dir` identity mapping, va = pa, will be saved in `ttbr0_el1`
* `init_pg_dir`, will be saved in `ttbr1_el1`. This page table will be freed in
  `paging_init` function.
* `swapper_pg_dir`

Why we need idmap:

> If the PA of the software that enables or disables a particular stage
  of address translation differs from its VA, speculative instruction
  fetching can cause complications. ARM strongly recommends that the PA
  and VA of any software that enables or disables a stage of address
  translation are identical if that stage of translation controls translations
  that apply to the software currently being executed.


### compute_indices

::: warning
The comment of code is not correct.
:::

return value:

istart = (vstart>>shift) & (ptrs-1), the index of page table to vstart.
iend = ((vend>>shift) & (ptrs-1)) + (count * ptrs), the index of page table to vend.
count = how many extra entries required for next page table level.

```c
/*
 * Compute indices of table entries from virtual address range. If multiple entries
 * were needed in the previous page table level then the next page table level is assumed
 * to be composed of multiple pages. (This effectively scales the end index).
 *
 *      vstart: virtual address of start of range
 *      vend:   virtual address of end of range
 *      shift:  shift used to transform virtual address into index
 *      ptrs:   number of entries in page table
 *      istart: index in table corresponding to vstart
 *      iend:   index in table corresponding to vend
 *      count:  On entry: how many extra entries were required in previous level, scales
 *                        our end index.
 *              On exit: returns how many extra entries required for next page table level
 *
 * Preserves:   vstart, vend, shift, ptrs
 * Returns:     istart, iend, count
 */
        .macro compute_indices, vstart, vend, shift, ptrs, istart, iend, count
        lsr     \iend, \vend, \shift
        mov     \istart, \ptrs
        sub     \istart, \istart, #1
        and     \iend, \iend, \istart   // iend = (vend >> shift) & (ptrs - 1)
        mov     \istart, \ptrs
        mul     \istart, \istart, \count
        add     \iend, \iend, \istart   // iend += (count - 1) * ptrs
                                        // our entries span multiple tables

        lsr     \istart, \vstart, \shift
        mov     \count, \ptrs
        sub     \count, \count, #1
        and     \istart, \istart, \count

        sub     \count, \iend, \istart
        .endm
```

### populate page table

The function allocates `eindex-index` the next level page tables (which is a page)
and fills page table entries.

```c
*
 * Macro to populate page table entries, these entries can be pointers to the next level
 * or last level entries pointing to physical memory.
 *
 *      tbl:    page table address
 *      rtbl:   pointer to page table or physical memory
 *      index:  start index to write
 *      eindex: end index to write - [index, eindex] written to
 *      flags:  flags for pagetable entry to or in
 *      inc:    increment to rtbl between each entry
 *      tmp1:   temporary variable
 *
 * Preserves:   tbl, eindex, flags, inc
 * Corrupts:    index, tmp1
 * Returns:     rtbl
 */
        .macro populate_entries, tbl, rtbl, index, eindex, flags, inc, tmp1
.Lpe\@: phys_to_pte \tmp1, \rtbl
        orr     \tmp1, \tmp1, \flags    // tmp1 = table entry
        str     \tmp1, [\tbl, \index, lsl #3]
        add     \rtbl, \rtbl, \inc      // rtbl = pa next level
        add     \index, \index, #1
        cmp     \index, \eindex
        b.ls    .Lpe\@
        .endm
```

### map_memory

`map_memory` maps `[vstart, vend]` to `[phys, vend-vstart+phys]`.

```c
/*
 * Map memory for specified virtual address range. Each level of page table needed supports
 * multiple entries. If a level requires n entries the next page table level is assumed to be
 * formed from n pages.
 *
 *      tbl:    location of page table
 *      rtbl:   address to be used for first level page table entry (typically tbl + PAGE_SIZE)
 *      vstart: start address to map
 *      vend:   end address to map - we map [vstart, vend]
 *      flags:  flags to use to map last level entries
 *      phys:   physical address corresponding to vstart - physical memory is contiguous
 *      pgds:   the number of pgd entries
 *
 * Temporaries: istart, iend, tmp, count, sv - these need to be different registers
 * Preserves:   vstart, vend, flags
 * Corrupts:    tbl, rtbl, istart, iend, tmp, count, sv
 */
        .macro map_memory, tbl, rtbl, vstart, vend, flags, phys, pgds, istart, iend, tmp, count, sv
        add \rtbl, \tbl, #PAGE_SIZE
        mov \sv, \rtbl
        mov \count, #0
        compute_indices \vstart, \vend, #PGDIR_SHIFT, \pgds, \istart, \iend, \count
        populate_entries \tbl, \rtbl, \istart, \iend, #PMD_TYPE_TABLE, #PAGE_SIZE, \tmp
        mov \tbl, \sv
        mov \sv, \rtbl

#if SWAPPER_PGTABLE_LEVELS > 3
        compute_indices \vstart, \vend, #PUD_SHIFT, #PTRS_PER_PUD, \istart, \iend, \count
        populate_entries \tbl, \rtbl, \istart, \iend, #PMD_TYPE_TABLE, #PAGE_SIZE, \tmp
        mov \tbl, \sv
        mov \sv, \rtbl
#endif

#if SWAPPER_PGTABLE_LEVELS > 2
        compute_indices \vstart, \vend, #SWAPPER_TABLE_SHIFT, #PTRS_PER_PMD, \istart, \iend, \count
        populate_entries \tbl, \rtbl, \istart, \iend, #PMD_TYPE_TABLE, #PAGE_SIZE, \tmp
        mov \tbl, \sv
#endif

        compute_indices \vstart, \vend, #SWAPPER_BLOCK_SHIFT, #PTRS_PER_PTE, \istart, \iend, \count
        // mask physical address with (#SWAPPER_BLOCK_SIZE - 1) and store in count
        bic \count, \phys, #SWAPPER_BLOCK_SIZE - 1
        populate_entries \tbl, \count, \istart, \iend, \flags, #SWAPPER_BLOCK_SIZE, \tmp
```

### __create_page_tables

`__create_page_tables` creates two mapping:

1. `[__idmap_text_start, __idmap_text_end]` to `[__idmap_text_start, __idmap_text_end]`
   in page table `idmap_pg_dir`
2. `[KIMAGE_VADDR + TEXT_OFFSET + kaslr, KIMAGE_VADDR + TEXT_OFFSET + kaslr + _end - _text]`
   to `[_text, _end]` in page table `init_pg_dir`

```
__create_page_tables:
```

```
        mov     x28, lr
```

```
        /*
         * Invalidate the init page tables to avoid potential dirty cache lines
         * being evicted. Other page tables are allocated in rodata as part of
         * the kernel image, and thus are clean to the PoC per the boot
         * protocol.
         */
        adrp    x0, init_pg_dir
        adrp    x1, init_pg_end
        sub     x1, x1, x0
        bl      __inval_dcache_area
```

invalidate dcache from `init_pg_dir` to `init_pg_end`.

```
        /*
         * Clear the init page tables.
         */
        adrp    x0, init_pg_dir
        adrp    x1, init_pg_end
        sub     x1, x1, x0
1:      stp     xzr, xzr, [x0], #16
        stp     xzr, xzr, [x0], #16
        stp     xzr, xzr, [x0], #16
        stp     xzr, xzr, [x0], #16
        subs    x1, x1, #64
        b.ne    1b
```

zero out from `init_pg_dir` to `init_pg_end`. It's a loop,
each iteration clear 64bytes.

Now we are goint to create page tables.

```c
        mov     x7, SWAPPER_MM_MMUFLAGS

        /*
         * Create the identity mapping.
         */
        adrp    x0, idmap_pg_dir
        adrp    x3, __idmap_text_start          // __pa(__idmap_text_start)
```

The following code handles va bit extension

```
#ifdef CONFIG_ARM64_VA_BITS_52
        mrs_s   x6, SYS_ID_AA64MMFR2_EL1
        and     x6, x6, #(0xf << ID_AA64MMFR2_LVA_SHIFT)
        mov     x5, #52
        cbnz    x6, 1f
#endif
        mov     x5, #VA_BITS_MIN
1:
        adr_l   x6, vabits_actual
        str     x5, [x6]
        dmb     sy
        dc      ivac, x6                // Invalidate potentially stale cache line

        /*
         * VA_BITS may be too small to allow for an ID mapping to be created
         * that covers system RAM if that is located sufficiently high in the
         * physical address space. So for the ID map, use an extended virtual
         * range in that case, and configure an additional translation level
         * if needed.
         *
         * Calculate the maximum allowed value for TCR_EL1.T0SZ so that the
         * entire ID map region can be mapped. As T0SZ == (64 - #bits used),
         * this number conveniently equals the number of leading zeroes in
         * the physical address of __idmap_text_end.
         */
        adrp    x5, __idmap_text_end
        clz     x5, x5
        cmp     x5, TCR_T0SZ(VA_BITS)   // default T0SZ small enough?
        b.ge    1f                      // .. then skip VA range extension

        adr_l   x6, idmap_t0sz
        str     x5, [x6]
        dmb     sy
        dc      ivac, x6                // Invalidate potentially stale cache line

#if (VA_BITS < 48)
#define EXTRA_SHIFT     (PGDIR_SHIFT + PAGE_SHIFT - 3)
#define EXTRA_PTRS      (1 << (PHYS_MASK_SHIFT - EXTRA_SHIFT))

        /*
         * If VA_BITS < 48, we have to configure an additional table level.
         * First, we have to verify our assumption that the current value of
         * VA_BITS was chosen such that all translation levels are fully
         * utilised, and that lowering T0SZ will always result in an additional
         * translation level to be configured.
         */
#if VA_BITS != EXTRA_SHIFT
#error "Mismatch between VA_BITS and page size/number of translation levels"
#endif

        mov     x4, EXTRA_PTRS
        create_table_entry x0, x3, EXTRA_SHIFT, x4, x5, x6
#else
        /*
         * If VA_BITS == 48, we don't have to configure an additional
         * translation level, but the top-level table has more entries.
         */
        mov     x4, #1 << (PHYS_MASK_SHIFT - PGDIR_SHIFT)
        str_l   x4, idmap_ptrs_per_pgd, x5
#endif
```

```c
1:
        ldr_l   x4, idmap_ptrs_per_pgd
        mov     x5, x3                          // __pa(__idmap_text_start)
        adr_l   x6, __idmap_text_end            // __pa(__idmap_text_end)

        map_memory x0, x1, x3, x6, x7, x3, x4, x10, x11, x12, x13, x14
```

Mapping kernel image in `init_pg_dir` page table.

```c
        /*
         * Map the kernel image (starting with PHYS_OFFSET).
         */
        adrp    x0, init_pg_dir
        mov_q   x5, KIMAGE_VADDR + TEXT_OFFSET  // compile time __va(_text)
        add     x5, x5, x23                     // add KASLR displacement
        mov     x4, PTRS_PER_PGD
        adrp    x6, _end                        // runtime __pa(_end)
        adrp    x3, _text                       // runtime __pa(_text)
        sub     x6, x6, x3                      // _end - _text
        add     x6, x6, x5                      // runtime __va(_end)

        map_memory x0, x1, x5, x6, x7, x3, x4, x10, x11, x12, x13, x14
```

flushing `[idmap_pg_dir, init_pg_end]`.

```c
        /*
         * Since the page tables have been populated with non-cacheable
         * accesses (MMU disabled), invalidate the idmap and swapper page
         * tables again to remove any speculatively loaded cache lines.
         */
        adrp    x0, idmap_pg_dir
        adrp    x1, init_pg_end
        sub     x1, x1, x0
        dmb     sy
        bl      __inval_dcache_area

        ret     x28
ENDPROC(__create_page_tables)
```

## __primary_switch

::: warning
We removed some code related to kaslr, see KASLR chapter for more details.
:::

This function enables mmu and jump to `__primary_switched`.

```c
__primary_switch:
        adrp    x1, init_pg_dir
        bl      __enable_mmu

        ldr     x8, =__primary_switched
        adrp    x0, __PHYS_OFFSET
        br      x8
ENDPROC(__primary_switch)
```

## __primary_switched

::: warning
We removed some code related to kaslr, see KASLR chapter for more details.
:::

```c
__primary_switched:
        adrp    x4, init_thread_union
        add     sp, x4, #THREAD_SIZE
```

points current `SP` to `init_thread_union + #THREAD_SIZE`.

```c
        adr_l   x5, init_task
        msr     sp_el0, x5                      // Save thread_info
```

`sp_el0` points to `init_task`.

```c
        adr_l   x8, vectors                     // load VBAR_EL1 with virtual
        msr     vbar_el1, x8                    // vector table address
        isb
```

setup exception vectors (see kernel/entry.S).

```c
        stp     xzr, x30, [sp, #-16]!
        mov     x29, sp
```

```c
        str_l   x21, __fdt_pointer, x5          // Save FDT pointer
```

Save the addres of dbt into `__fdt_pointer` for `kaslr_early_init`, we ignore it here.

```c
        ldr_l   x4, kimage_vaddr                // Save the offset between
        sub     x4, x4, x0                      // the kernel virtual and
        str_l   x4, kimage_voffset, x5          // physical mappings
```

save `kimage_vaddr - __PHYS_OFFSET` into `kimage_voffset`. The offset between
the kernel virtual and physical mappings. Used to translate virtual to physical addresses.

See `Documentation/admin-guide/kdump/vmcoreinfo.rst`.

```c
        // Clear BSS
        adr_l   x0, __bss_start
        mov     x1, xzr
        adr_l   x2, __bss_stop
        sub     x2, x2, x0
        bl      __pi_memset
        dsb     ishst                           // Make zero page visible to PTW
```

clears bss section.

```c
        add     sp, sp, #16
        mov     x29, #0
        mov     x30, #0
        b       start_kernel
ENDPROC(__primary_switched)
```

jumps to `start_kernel`.

## Reference

> https://evsio0n.com/archives/316/

> http://gngshn.github.io/2017/11/30/arm64-linux启动流程分析08-正式跳入内核空间虚拟地址段运行/

> Documentation/admin-guide/kdump/vmcoreinfo.rst