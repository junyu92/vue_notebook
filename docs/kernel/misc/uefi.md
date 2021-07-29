# UEFI

The Unified Extensible Firmware Interface (UEFI) is a publicly
available specification that defines a software interface between
an operating system and platform firmware.

Booting on a platform with firmware compliant with the UEFI
specification makes it possible for the kernel to support
additional features:

* UEFI Runtime Services
* Retrieving various configuration information throught the
  standardised interface of UEFI configuration tables.
  (ACPI, SMBIOS, ...)

To enable UEFI support,

```
CONFIG_EFI=y
CONFIG_EFIVAR_FS=y or m
```

should be set.

## UEFI stub

The "stub" is a feature that extends the Image/zImage into a valid UEFI
PE/COFF executable, including a loader application that makes it possible to
load the kernel directly from the UEFI shell, boot menu, or one of the
lightweight bootloaders like Gummiboot or rEFInd.

## efi_system_table

The `EFI_SYSTEM_TABLE` is the key to accessing most of an EFI
environment's features. This data structure includes a number
of pointers, some of which point to additional data structures
that provide access to EFI system calls

```c
typedef struct {
        efi_table_hdr_t hdr;
        unsigned long fw_vendor;        /* physical addr of CHAR16 vendor string */
        u32 fw_revision;
        unsigned long con_in_handle;
        unsigned long con_in;
        unsigned long con_out_handle;
        unsigned long con_out;
        unsigned long stderr_handle;
        unsigned long stderr;
        efi_runtime_services_t *runtime;
        efi_boot_services_t *boottime;
        unsigned long nr_tables;
        unsigned long tables;
} efi_system_table_t;
```

## UEFI kernel support on ARM

When booting in UEFI mode, the stub deletes any memory nodes
from a provided DT. Instead, the kernel reads the UEFI memory map.

```c
        /*
         * We arrive here from the EFI boot manager with:
         *
         *    * CPU in little-endian mode
         *    * MMU on with identity-mapped RAM
         *    * Icache and Dcache on
         *
         * We will most likely be running from some place other than where
         * we want to be. The kernel image wants to be placed at TEXT_OFFSET
         * from start of RAM.
         */
ENTRY(entry)
        /*
         * Create a stack frame to save FP/LR with extra space
         * for image_addr variable passed to efi_entry().
         */
        stp     x29, x30, [sp, #-32]!
        mov     x29, sp
```

call `efi_entry`, x0 is `handle`, x1 is `sys_table` and x2 is the
address of `_text` which is image addr.

```c
        /*
         * Call efi_entry to do the real work.
         * x0 and x1 are already set up by firmware. Current runtime
         * address of image is calculated and passed via *image_addr.
         *
         * unsigned long efi_entry(void *handle,
         *                         efi_system_table_t *sys_table,
         *                         unsigned long *image_addr) ;
         */
        adr_l   x8, _text
        add     x2, sp, 16
        str     x8, [x2]
        bl      efi_entry
        cmn     x0, #1
        b.eq    efi_load_fail
```

Now `x0` is the return value of `efi_entry` which is the address of new fdt.

```c
        /*
         * efi_entry() will have copied the kernel image if necessary and we
         * return here with device tree address in x0 and the kernel entry
         * point stored at *image_addr. Save those values in registers which
         * are callee preserved.
         */
        mov     x20, x0         // DTB address
        ldr     x0, [sp, #16]   // relocated _text address
        ldr     w21, =stext_offset
        add     x21, x0, x21

        /*
         * Calculate size of the kernel Image (same for original and copy).
         */
        adr_l   x1, _text
        adr_l   x2, _edata
        sub     x1, x2, x1

        /*
         * Flush the copied Image to the PoC, and ensure it is not shadowed by
         * stale icache entries from before relocation.
         */
        bl      __flush_dcache_area
        ic      ialluis

        /*
         * Ensure that the rest of this function (in the original Image) is
         * visible when the caches are disabled. The I-cache can't have stale
         * entries for the VA range of the current image, so no maintenance is
         * necessary.
         */
        adr     x0, entry
        adr     x1, entry_end
        sub     x1, x1, x0
        bl      __flush_dcache_area

        /* Turn off Dcache and MMU */
        mrs     x0, CurrentEL
        cmp     x0, #CurrentEL_EL2
        b.ne    1f
        mrs     x0, sctlr_el2
        bic     x0, x0, #1 << 0 // clear SCTLR.M
        bic     x0, x0, #1 << 2 // clear SCTLR.C
        pre_disable_mmu_workaround
        msr     sctlr_el2, x0
        isb
        b       2f
1:
        mrs     x0, sctlr_el1
        bic     x0, x0, #1 << 0 // clear SCTLR.M
        bic     x0, x0, #1 << 2 // clear SCTLR.C
        pre_disable_mmu_workaround
        msr     sctlr_el1, x0
        isb
2:
        /* Jump to kernel entry point */
        mov     x0, x20
        mov     x1, xzr
        mov     x2, xzr
        mov     x3, xzr
        br      x21

efi_load_fail:
        mov     x0, #EFI_LOAD_ERROR
        ldp     x29, x30, [sp], #32
        ret

entry_end:
ENDPROC(entry)
```


### efi_entry

```c
/*
 * EFI entry point for the arm/arm64 EFI stubs.  This is the entrypoint
 * that is described in the PE/COFF header.  Most of the code is the same
 * for both archictectures, with the arch-specific code provided in the
 * handle_kernel_image() function.
 */
unsigned long efi_entry(void *handle, efi_system_table_t *sys_table,
                               unsigned long *image_addr)
{
        efi_loaded_image_t *image;
        efi_status_t status;
        unsigned long image_size = 0;
        unsigned long dram_base;
        /* addr/point and size pairs for memory management*/
        unsigned long initrd_addr;
        u64 initrd_size = 0;
        unsigned long fdt_addr = 0;  /* Original DTB */
        unsigned long fdt_size = 0;
        char *cmdline_ptr = NULL;
        int cmdline_size = 0;
        unsigned long new_fdt_addr;
        efi_guid_t loaded_image_proto = LOADED_IMAGE_PROTOCOL_GUID;
        unsigned long reserve_addr = 0;
        unsigned long reserve_size = 0;
        enum efi_secureboot_mode secure_boot;
        struct screen_info *si;

        /* Check if we were booted by the EFI firmware */
        if (sys_table->hdr.signature != EFI_SYSTEM_TABLE_SIGNATURE)
                goto fail;

        status = check_platform_features(sys_table);
        if (status != EFI_SUCCESS)
                goto fail;

        /*
         * Get a handle to the loaded image protocol.  This is used to get
         * information about the running image, such as size and the command
         * line.
         */
        status = sys_table->boottime->handle_protocol(handle,
                                        &loaded_image_proto, (void *)&image);
        if (status != EFI_SUCCESS) {
                pr_efi_err(sys_table, "Failed to get loaded image protocol\n");
                goto fail;
        }

        dram_base = get_dram_base(sys_table);
        if (dram_base == EFI_ERROR) {
                pr_efi_err(sys_table, "Failed to find DRAM base\n");
                goto fail;
        }

        /*
         * Get the command line from EFI, using the LOADED_IMAGE
         * protocol. We are going to copy the command line into the
         * device tree, so this can be allocated anywhere.
         */
        cmdline_ptr = efi_convert_cmdline(sys_table, image, &cmdline_size);
        if (!cmdline_ptr) {
                pr_efi_err(sys_table, "getting command line via LOADED_IMAGE_PROTOCOL\n");
                goto fail;
        }

        if (IS_ENABLED(CONFIG_CMDLINE_EXTEND) ||
            IS_ENABLED(CONFIG_CMDLINE_FORCE) ||
            cmdline_size == 0)
                efi_parse_options(CONFIG_CMDLINE);

        if (!IS_ENABLED(CONFIG_CMDLINE_FORCE) && cmdline_size > 0)
                efi_parse_options(cmdline_ptr);

        pr_efi(sys_table, "Booting Linux Kernel...\n");

        si = setup_graphics(sys_table);

        status = handle_kernel_image(sys_table, image_addr, &image_size,
                                     &reserve_addr,
                                     &reserve_size,
                                     dram_base, image);
        if (status != EFI_SUCCESS) {
                pr_efi_err(sys_table, "Failed to relocate kernel\n");
                goto fail_free_cmdline;
        }

        /* Ask the firmware to clear memory on unclean shutdown */
        efi_enable_reset_attack_mitigation(sys_table);

        secure_boot = efi_get_secureboot(sys_table);

        /*
         * Unauthenticated device tree data is a security hazard, so ignore
         * 'dtb=' unless UEFI Secure Boot is disabled.  We assume that secure
         * boot is enabled if we can't determine its state.
         */
        if (!IS_ENABLED(CONFIG_EFI_ARMSTUB_DTB_LOADER) ||
             secure_boot != efi_secureboot_mode_disabled) {
                if (strstr(cmdline_ptr, "dtb="))
                        pr_efi(sys_table, "Ignoring DTB from command line.\n");
        } else {
                status = handle_cmdline_files(sys_table, image, cmdline_ptr,
                                              "dtb=",
                                              ~0UL, &fdt_addr, &fdt_size);

                if (status != EFI_SUCCESS) {
                        pr_efi_err(sys_table, "Failed to load device tree!\n");
                        goto fail_free_image;
                }
        }

        if (fdt_addr) {
                pr_efi(sys_table, "Using DTB from command line\n");
        } else {
                /* Look for a device tree configuration table entry. */
                fdt_addr = (uintptr_t)get_fdt(sys_table, &fdt_size);
                if (fdt_addr)
                        pr_efi(sys_table, "Using DTB from configuration table\n");
        }

        if (!fdt_addr)
                pr_efi(sys_table, "Generating empty DTB\n");

        status = handle_cmdline_files(sys_table, image, cmdline_ptr, "initrd=",
                                      efi_get_max_initrd_addr(dram_base,
                                                              *image_addr),
                                      (unsigned long *)&initrd_addr,
                                      (unsigned long *)&initrd_size);
        if (status != EFI_SUCCESS)
                pr_efi_err(sys_table, "Failed initrd from command line!\n");

        efi_random_get_seed(sys_table);

        /* hibernation expects the runtime regions to stay in the same place */
        if (!IS_ENABLED(CONFIG_HIBERNATION) && !nokaslr()) {
                /*
                 * Randomize the base of the UEFI runtime services region.
                 * Preserve the 2 MB alignment of the region by taking a
                 * shift of 21 bit positions into account when scaling
                 * the headroom value using a 32-bit random value.
                 */
                static const u64 headroom = EFI_RT_VIRTUAL_LIMIT -
                                            EFI_RT_VIRTUAL_BASE -
                                            EFI_RT_VIRTUAL_SIZE;
                u32 rnd;

                status = efi_get_random_bytes(sys_table, sizeof(rnd),
                                              (u8 *)&rnd);
                if (status == EFI_SUCCESS) {
                        virtmap_base = EFI_RT_VIRTUAL_BASE +
                                       (((headroom >> 21) * rnd) >> (32 - 21));
                }
        }

        install_memreserve_table(sys_table);

        new_fdt_addr = fdt_addr;
        status = allocate_new_fdt_and_exit_boot(sys_table, handle,
                                &new_fdt_addr, efi_get_max_fdt_addr(dram_base),
                                initrd_addr, initrd_size, cmdline_ptr,
                                fdt_addr, fdt_size);

        /*
         * If all went well, we need to return the FDT address to the
         * calling function so it can be passed to kernel as part of
         * the kernel boot protocol.
         */
        if (status == EFI_SUCCESS)
                return new_fdt_addr;

        pr_efi_err(sys_table, "Failed to update FDT and exit boot services\n");

        efi_free(sys_table, initrd_size, initrd_addr);
        efi_free(sys_table, fdt_size, fdt_addr);

fail_free_image:
        efi_free(sys_table, image_size, *image_addr);
        efi_free(sys_table, reserve_size, reserve_addr);
fail_free_cmdline:
        free_screen_info(sys_table, si);
        efi_free(sys_table, cmdline_size, (unsigned long)cmdline_ptr);
fail:
        return EFI_ERROR;
}
```

### efi_init