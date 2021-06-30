# ASID

## Introduction

## init

```c
static int asids_init(void)
{
        asid_bits = get_cpu_asid_bits();
        /*
         * Expect allocation after rollover to fail if we don't have at least
         * one more ASID than CPUs. ASID #0 is reserved for init_mm.
         */
        WARN_ON(NUM_USER_ASIDS - 1 <= num_possible_cpus());
        atomic64_set(&asid_generation, ASID_FIRST_VERSION);
        asid_map = kcalloc(BITS_TO_LONGS(NUM_USER_ASIDS), sizeof(*asid_map),
                           GFP_KERNEL);
        if (!asid_map)
                panic("Failed to allocate bitmap for %lu ASIDs\n",
                      NUM_USER_ASIDS);

        pr_info("ASID allocator initialised with %lu entries\n", NUM_USER_ASIDS);
        return 0;
}
early_initcall(asids_init);
```

## Allocate context for task

```c
static u64 new_context(struct mm_struct *mm)
{
        static u32 cur_idx = 1;
        u64 asid = atomic64_read(&mm->context.id);
        u64 generation = atomic64_read(&asid_generation);

        if (asid != 0) {
                u64 newasid = generation | (asid & ~ASID_MASK);

                /*
                 * If our current ASID was active during a rollover, we
                 * can continue to use it and this was just a false alarm.
                 */
                if (check_update_reserved_asid(asid, newasid))
                        return newasid;

                /*
                 * We had a valid ASID in a previous life, so try to re-use
                 * it if possible.
                 */
                if (!__test_and_set_bit(asid2idx(asid), asid_map))
                        return newasid;
        }

        /*
         * Allocate a free ASID. If we can't find one, take a note of the
         * currently active ASIDs and mark the TLBs as requiring flushes.  We
         * always count from ASID #2 (index 1), as we use ASID #0 when setting
         * a reserved TTBR0 for the init_mm and we allocate ASIDs in even/odd
         * pairs.
         */
        asid = find_next_zero_bit(asid_map, NUM_USER_ASIDS, cur_idx);
        if (asid != NUM_USER_ASIDS)
                goto set_asid;

        /* We're out of ASIDs, so increment the global generation count */
        generation = atomic64_add_return_relaxed(ASID_FIRST_VERSION,
                                                 &asid_generation);
        flush_context();

        /* We have more ASIDs than CPUs, so this will always succeed */
        asid = find_next_zero_bit(asid_map, NUM_USER_ASIDS, 1);

set_asid:
        __set_bit(asid, asid_map);
        cur_idx = asid;
        return idx2asid(asid) | generation;
}
```