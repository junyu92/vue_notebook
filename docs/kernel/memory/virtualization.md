# Memory Virtualization

## VM Exit

Memory Data Abort causes vm exiting, and `kvm_handle_guest_abort` should
handle it.

```c
static exit_handle_fn kvm_get_exit_handler(struct kvm_vcpu *vcpu)
{
        u32 hsr = kvm_vcpu_get_hsr(vcpu);
        u8 hsr_ec = ESR_ELx_EC(hsr);

        return arm_exit_handlers[hsr_ec];
}
```

```c{15,16}
static exit_handle_fn arm_exit_handlers[] = {
        [0 ... ESR_ELx_EC_MAX]  = kvm_handle_unknown_ec,
        [ESR_ELx_EC_WFx]        = kvm_handle_wfx,
        [ESR_ELx_EC_CP15_32]    = kvm_handle_cp15_32,
        [ESR_ELx_EC_CP15_64]    = kvm_handle_cp15_64,
        [ESR_ELx_EC_CP14_MR]    = kvm_handle_cp14_32,
        [ESR_ELx_EC_CP14_LS]    = kvm_handle_cp14_load_store,
        [ESR_ELx_EC_CP14_64]    = kvm_handle_cp14_64,
        [ESR_ELx_EC_HVC32]      = handle_hvc,
        [ESR_ELx_EC_SMC32]      = handle_smc,
        [ESR_ELx_EC_HVC64]      = handle_hvc,
        [ESR_ELx_EC_SMC64]      = handle_smc,
        [ESR_ELx_EC_SYS64]      = kvm_handle_sys_reg,
        [ESR_ELx_EC_SVE]        = handle_sve,
        [ESR_ELx_EC_IABT_LOW]   = kvm_handle_guest_abort,
        [ESR_ELx_EC_DABT_LOW]   = kvm_handle_guest_abort,
        [ESR_ELx_EC_SOFTSTP_LOW]= kvm_handle_guest_debug,
        [ESR_ELx_EC_WATCHPT_LOW]= kvm_handle_guest_debug,
        [ESR_ELx_EC_BREAKPT_LOW]= kvm_handle_guest_debug,
        [ESR_ELx_EC_BKPT32]     = kvm_handle_guest_debug,
        [ESR_ELx_EC_BRK64]      = kvm_handle_guest_debug,
        [ESR_ELx_EC_FP_ASIMD]   = handle_no_fpsimd,
        [ESR_ELx_EC_PAC]        = kvm_handle_ptrauth,
};
```

### kvm_handle_guest_abort

This function handles all 2nd-stage aborts. Two cases could cause
2nd-stage aborts.

* guest needs more memory and we must allocate an appropriate page
* guest tried to access I/O memory, which is emulated by user space

```c
int kvm_handle_guest_abort(struct kvm_vcpu *vcpu, struct kvm_run *run)
{
        unsigned long fault_status;
        phys_addr_t fault_ipa;
        struct kvm_memory_slot *memslot;
        unsigned long hva;
        bool is_iabt, write_fault, writable;
        gfn_t gfn;
        int ret, idx;

        fault_status = kvm_vcpu_trap_get_fault_type(vcpu);

        fault_ipa = kvm_vcpu_get_fault_ipa(vcpu);
        is_iabt = kvm_vcpu_trap_is_iabt(vcpu);
```

1. Synchronous External abort

```c
/* Shared ISS fault status code(IFSC/DFSC) for Data/Instruction aborts */
#define ESR_ELx_FSC             (0x3F)
#define ESR_ELx_FSC_TYPE        (0x3C)
#define ESR_ELx_FSC_EXTABT      (0x10)
#define ESR_ELx_FSC_SERROR      (0x11)
#define ESR_ELx_FSC_ACCESS      (0x08)
#define ESR_ELx_FSC_FAULT       (0x04)
#define ESR_ELx_FSC_PERM        (0x0C)

#define FSC_FAULT       ESR_ELx_FSC_FAULT
// Access flag fault
#define FSC_ACCESS      ESR_ELx_FSC_ACCESS
// Permission fault
#define FSC_PERM        ESR_ELx_FSC_PERM
// Synchronous External abort, not on translation table walk or
// hardware update of translation table.
#define FSC_SEA         ESR_ELx_FSC_EXTABT
// The following 4 macro are translation table walk
#define FSC_SEA_TTW0    (0x14)
#define FSC_SEA_TTW1    (0x15)
#define FSC_SEA_TTW2    (0x16)
#define FSC_SEA_TTW3    (0x17)
// The following 5 are ecc error
#define FSC_SECC        (0x18)
#define FSC_SECC_TTW0   (0x1c)
#define FSC_SECC_TTW1   (0x1d)
#define FSC_SECC_TTW2   (0x1e)
#define FSC_SECC_TTW3   (0x1f)
```

```c
        /* Synchronous External Abort? */
        if (kvm_vcpu_dabt_isextabt(vcpu)) {
                /*
                 * For RAS the host kernel may handle this abort.
                 * There is no need to pass the error into the guest.
                 */
                if (!handle_guest_sea(fault_ipa, kvm_vcpu_get_hsr(vcpu)))
                        return 1;

                if (unlikely(!is_iabt)) {
                        kvm_inject_vabt(vcpu);
                        return 1;
                }
        }
```

Then we only handle translation faule (`FSC_FAULT`),
permission fault (`FSC_PERM`) and access flag fault (`FSC_ACCESS`).

```c
        trace_kvm_guest_fault(*vcpu_pc(vcpu), kvm_vcpu_get_hsr(vcpu),
                              kvm_vcpu_get_hfar(vcpu), fault_ipa);

        /* Check the stage-2 fault is trans. fault or write fault */
        if (fault_status != FSC_FAULT && fault_status != FSC_PERM &&
            fault_status != FSC_ACCESS) {
                kvm_err("Unsupported FSC: EC=%#x xFSC=%#lx ESR_EL2=%#lx\n",
                        kvm_vcpu_trap_get_class(vcpu),
                        (unsigned long)kvm_vcpu_trap_get_fault(vcpu),
                        (unsigned long)kvm_vcpu_get_hsr(vcpu));
                return -EFAULT;
        }

        idx = srcu_read_lock(&vcpu->kvm->srcu);

        gfn = fault_ipa >> PAGE_SHIFT;
        memslot = gfn_to_memslot(vcpu->kvm, gfn);
        hva = gfn_to_hva_memslot_prot(memslot, gfn, &writable);
        write_fault = kvm_is_write_fault(vcpu);
```

2. MMIO

Error `hva` means the address of `gpa` is MMIO address.

```c
        if (kvm_is_error_hva(hva) || (write_fault && !writable)) {
                if (is_iabt) {
                        /* Prefetch Abort on I/O address */
                        kvm_inject_pabt(vcpu, kvm_vcpu_get_hfar(vcpu));
                        ret = 1;
                        goto out_unlock;
                }

                /*
                 * Check for a cache maintenance operation. Since we
                 * ended-up here, we know it is outside of any memory
                 * slot. But we can't find out if that is for a device,
                 * or if the guest is just being stupid. The only thing
                 * we know for sure is that this range cannot be cached.
                 *
                 * So let's assume that the guest is just being
                 * cautious, and skip the instruction.
                 */
                if (kvm_vcpu_dabt_is_cm(vcpu)) {
                        kvm_skip_instr(vcpu, kvm_vcpu_trap_il_is32bit(vcpu));
                        ret = 1;
                        goto out_unlock;
                }

                /*
                 * The IPA is reported as [MAX:12], so we need to
                 * complement it with the bottom 12 bits from the
                 * faulting VA. This is always 12 bits, irrespective
                 * of the page size.
                 */
                fault_ipa |= kvm_vcpu_get_hfar(vcpu) & ((1 << 12) - 1);
                ret = io_mem_abort(vcpu, run, fault_ipa);
                goto out_unlock;
        }
```

`io_mem_abort` dispatches MMIO access.

If the kernel can handle it (for example, guest accesses GIC chip), directly
return 1 so we won't go back to userspace.

```c
int io_mem_abort(struct kvm_vcpu *vcpu, struct kvm_run *run,
                 phys_addr_t fault_ipa)
{
        unsigned long data;
        unsigned long rt;
        int ret;
        bool is_write;
        int len;
        u8 data_buf[8];

        /*
         * Prepare MMIO operation. First decode the syndrome data we get
         * from the CPU. Then try if some in-kernel emulation feels
         * responsible, otherwise let user space do its magic.
         */
        if (kvm_vcpu_dabt_isvalid(vcpu)) {
                ret = decode_hsr(vcpu, &is_write, &len);
                if (ret)
                        return ret;
        } else {
                kvm_err("load/store instruction decoding not implemented\n");
                return -ENOSYS;
        }

        rt = vcpu->arch.mmio_decode.rt;

        if (is_write) {
                data = vcpu_data_guest_to_host(vcpu, vcpu_get_reg(vcpu, rt),
                                               len);

                trace_kvm_mmio(KVM_TRACE_MMIO_WRITE, len, fault_ipa, &data);
                kvm_mmio_write_buf(data_buf, len, data);

                ret = kvm_io_bus_write(vcpu, KVM_MMIO_BUS, fault_ipa, len,
                                       data_buf);
        } else {
                trace_kvm_mmio(KVM_TRACE_MMIO_READ_UNSATISFIED, len,
                               fault_ipa, NULL);

                ret = kvm_io_bus_read(vcpu, KVM_MMIO_BUS, fault_ipa, len,
                                      data_buf);
        }

        /* Now prepare kvm_run for the potential return to userland. */
        run->mmio.is_write      = is_write;
        run->mmio.phys_addr     = fault_ipa;
        run->mmio.len           = len;

        if (!ret) {
                /* We handled the access successfully in the kernel. */
                if (!is_write)
                        memcpy(run->mmio.data, data_buf, len);
                vcpu->stat.mmio_exit_kernel++;
                kvm_handle_mmio_return(vcpu, run);
                return 1;
        }

        if (is_write)
                memcpy(run->mmio.data, data_buf, len);
        vcpu->stat.mmio_exit_user++;
        run->exit_reason        = KVM_EXIT_MMIO;
        return 0;
}
```

3. Access flag abort

```c
        /* Userspace should not be able to register out-of-bounds IPAs */
        VM_BUG_ON(fault_ipa >= kvm_phys_size(vcpu->kvm));

        if (fault_status == FSC_ACCESS) {
                handle_access_fault(vcpu, fault_ipa);
                ret = 1;
                goto out_unlock;
        }
```

```c
/*
 * Resolve the access fault by making the page young again.
 * Note that because the faulting entry is guaranteed not to be
 * cached in the TLB, we don't need to invalidate anything.
 * Only the HW Access Flag updates are supported for Stage 2 (no DBM),
 * so there is no need for atomic (pte|pmd)_mkyoung operations.
 */
static void handle_access_fault(struct kvm_vcpu *vcpu, phys_addr_t fault_ipa)
{
        pud_t *pud;
        pmd_t *pmd;
        pte_t *pte;
        kvm_pfn_t pfn;
        bool pfn_valid = false;

        trace_kvm_access_fault(fault_ipa);

        spin_lock(&vcpu->kvm->mmu_lock);

        if (!stage2_get_leaf_entry(vcpu->kvm, fault_ipa, &pud, &pmd, &pte))
                goto out;

        if (pud) {              /* HugeTLB */
                *pud = kvm_s2pud_mkyoung(*pud);
                pfn = kvm_pud_pfn(*pud);
                pfn_valid = true;
        } else  if (pmd) {      /* THP, HugeTLB */
                *pmd = pmd_mkyoung(*pmd);
                pfn = pmd_pfn(*pmd);
                pfn_valid = true;
        } else {
                *pte = pte_mkyoung(*pte);       /* Just a page... */
                pfn = pte_pfn(*pte);
                pfn_valid = true;
        }

out:
        spin_unlock(&vcpu->kvm->mmu_lock);
        if (pfn_valid)
                kvm_set_pfn_accessed(pfn);
}
```

4. Translation and Permission abort

Back to `kvm_handle_guest_abort`, `user_mem_abort` handles permission abort
and translation fault.

```c
        ret = user_mem_abort(vcpu, fault_ipa, memslot, hva, fault_status);
```

ARM Memory Virtualization supports:

* `PUD_SIZE` huge page
* `PMD_SIZE` huge page
* 4K page

```c
static int user_mem_abort(struct kvm_vcpu *vcpu, phys_addr_t fault_ipa,
                          struct kvm_memory_slot *memslot, unsigned long hva,
                          unsigned long fault_status)
{
        int ret;
        bool write_fault, writable, force_pte = false;
        bool exec_fault, needs_exec;
        unsigned long mmu_seq;
        gfn_t gfn = fault_ipa >> PAGE_SHIFT;
        struct kvm *kvm = vcpu->kvm;
        struct kvm_mmu_memory_cache *memcache = &vcpu->arch.mmu_page_cache;
        struct vm_area_struct *vma;
        kvm_pfn_t pfn;
        pgprot_t mem_type = PAGE_S2;
        bool logging_active = memslot_is_logging(memslot);
        unsigned long vma_pagesize, flags = 0;

        write_fault = kvm_is_write_fault(vcpu);
        exec_fault = kvm_vcpu_trap_is_iabt(vcpu);
        VM_BUG_ON(write_fault && exec_fault);

        if (fault_status == FSC_PERM && !write_fault && !exec_fault) {
                kvm_err("Unexpected L2 read permission error\n");
                return -EFAULT;
        }

        if (!fault_supports_stage2_pmd_mappings(memslot, hva))
                force_pte = true;

        // If dirty logging is enabled, we only support 4K page
        if (logging_active)
                force_pte = true;

        /* Let's check if we will get back a huge page backed by hugetlbfs */
        down_read(&current->mm->mmap_sem);
        vma = find_vma_intersection(current->mm, hva, hva + 1);
        if (unlikely(!vma)) {
                kvm_err("Failed to find VMA for hva 0x%lx\n", hva);
                up_read(&current->mm->mmap_sem);
                return -EFAULT;
        }

        // return the size of the pages allocated when backing a VMA
        vma_pagesize = vma_kernel_pagesize(vma);
        // align the gfn to the size of huge page
        /*
         * The stage2 has a minimum of 2 level table (For arm64 see
         * kvm_arm_setup_stage2()). Hence, we are guaranteed that we can
         * use PMD_SIZE huge mappings (even when the PMD is folded into PGD).
         * As for PUD huge maps, we must make sure that we have at least
         * 3 levels, i.e, PMD is not folded.
         */
        if ((vma_pagesize == PMD_SIZE ||
             (vma_pagesize == PUD_SIZE && kvm_stage2_has_pmd(kvm))) &&
            !force_pte) {
                gfn = (fault_ipa & huge_page_mask(hstate_vma(vma))) >> PAGE_SHIFT;
        }
        up_read(&current->mm->mmap_sem);

        /* We need minimum second+third level pages */
        // prefetch some pages so building page table won't fail
        ret = mmu_topup_memory_cache(memcache, kvm_mmu_cache_min_pages(kvm),
                                     KVM_NR_MEM_OBJS);
        if (ret)
                return ret;

        mmu_seq = vcpu->kvm->mmu_notifier_seq;
        /*
         * Ensure the read of mmu_notifier_seq happens before we call
         * gfn_to_pfn_prot (which calls get_user_pages), so that we don't risk
         * the page we just got a reference to gets unmapped before we have a
         * chance to grab the mmu_lock, which ensure that if the page gets
         * unmapped afterwards, the call to kvm_unmap_hva will take it away
         * from us again properly. This smp_rmb() interacts with the smp_wmb()
         * in kvm_mmu_notifier_invalidate_<page|range_end>.
         */
        smp_rmb();

        pfn = gfn_to_pfn_prot(kvm, gfn, write_fault, &writable);
        if (pfn == KVM_PFN_ERR_HWPOISON) {
                kvm_send_hwpoison_signal(hva, vma);
                return 0;
        }
        if (is_error_noslot_pfn(pfn))
                return -EFAULT;

        if (kvm_is_device_pfn(pfn)) {
                mem_type = PAGE_S2_DEVICE;
                flags |= KVM_S2PTE_FLAG_IS_IOMAP;
        } else if (logging_active) {
                /*
                 * Faults on pages in a memslot with logging enabled
                 * should not be mapped with huge pages (it introduces churn
                 * and performance degradation), so force a pte mapping.
                 */
                flags |= KVM_S2_FLAG_LOGGING_ACTIVE;

                /*
                 * Only actually map the page as writable if this was a write
                 * fault.
                 */
                if (!write_fault)
                        writable = false;
        }

        spin_lock(&kvm->mmu_lock);
        if (mmu_notifier_retry(kvm, mmu_seq))
                goto out_unlock;

        if (vma_pagesize == PAGE_SIZE && !force_pte) {
                /*
                 * Only PMD_SIZE transparent hugepages(THP) are
                 * currently supported. This code will need to be
                 * updated to support other THP sizes.
                 */
                if (transparent_hugepage_adjust(&pfn, &fault_ipa))
                        vma_pagesize = PMD_SIZE;
        }

        if (writable)
                kvm_set_pfn_dirty(pfn);

        if (fault_status != FSC_PERM)
                clean_dcache_guest_page(pfn, vma_pagesize);

        if (exec_fault)
                invalidate_icache_guest_page(pfn, vma_pagesize);

        /*
         * If we took an execution fault we have made the
         * icache/dcache coherent above and should now let the s2
         * mapping be executable.
         *
         * Write faults (!exec_fault && FSC_PERM) are orthogonal to
         * execute permissions, and we preserve whatever we have.
         */
        needs_exec = exec_fault ||
                (fault_status == FSC_PERM && stage2_is_exec(kvm, fault_ipa));

        // setup stage-2 page table
        if (vma_pagesize == PUD_SIZE) {
                pud_t new_pud = kvm_pfn_pud(pfn, mem_type);

                new_pud = kvm_pud_mkhuge(new_pud);
                if (writable)
                        new_pud = kvm_s2pud_mkwrite(new_pud);

                if (needs_exec)
                        new_pud = kvm_s2pud_mkexec(new_pud);

                ret = stage2_set_pud_huge(kvm, memcache, fault_ipa, &new_pud);
        } else if (vma_pagesize == PMD_SIZE) {
                pmd_t new_pmd = kvm_pfn_pmd(pfn, mem_type);

                new_pmd = kvm_pmd_mkhuge(new_pmd);

                if (writable)
                        new_pmd = kvm_s2pmd_mkwrite(new_pmd);

                if (needs_exec)
                        new_pmd = kvm_s2pmd_mkexec(new_pmd);

                ret = stage2_set_pmd_huge(kvm, memcache, fault_ipa, &new_pmd);
        } else {
                pte_t new_pte = kvm_pfn_pte(pfn, mem_type);

                if (writable) {
                        new_pte = kvm_s2pte_mkwrite(new_pte);
                        mark_page_dirty(kvm, gfn);
                }

                if (needs_exec)
                        new_pte = kvm_s2pte_mkexec(new_pte);

                ret = stage2_set_pte(kvm, memcache, fault_ipa, &new_pte, flags);
        }

out_unlock:
        spin_unlock(&kvm->mmu_lock);
        kvm_set_pfn_accessed(pfn);
        kvm_release_pfn_clean(pfn);
        return ret;
}
```

Finally, `kvm_handle_guest_abort` finished.

```c
        if (ret == 0)
                ret = 1;
out_unlock:
        srcu_read_unlock(&vcpu->kvm->srcu, idx);
        return ret;
}
```

## Reference

> armv8 specification. D5