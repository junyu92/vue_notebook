# Alternative CB on ARM64

With the help of *alternative_cb*, Instruction can be altered
at runtime while kernel/module is loading.

For example,

```c
static inline unsigned long __kern_hyp_va(unsigned long v)
{
        asm volatile(ALTERNATIVE_CB("and %0, %0, #1\n"
                                    "ror %0, %0, #1\n"
                                    "add %0, %0, #0\n"
                                    "add %0, %0, #0, lsl 12\n"
                                    "ror %0, %0, #63\n",
                                    kvm_update_va_mask)
                     : "+r" (v));
        return v;
}
```

## Altinstructions when modules is loading

The very last stage of loading module is to `apply_alternatives_module`.

```c
int module_finalize(const Elf_Ehdr *hdr,
                    const Elf_Shdr *sechdrs,
                    struct module *me)
{
        const Elf_Shdr *s, *se;
        const char *secstrs = (void *)hdr + sechdrs[hdr->e_shstrndx].sh_offset;

        for (s = sechdrs, se = sechdrs + hdr->e_shnum; s < se; s++) {
                if (strcmp(".altinstructions", secstrs + s->sh_name) == 0)
                        apply_alternatives_module((void *)s->sh_addr, s->sh_size);
#ifdef CONFIG_ARM64_MODULE_PLTS
                if (IS_ENABLED(CONFIG_DYNAMIC_FTRACE) &&
                    !strcmp(".text.ftrace_trampoline", secstrs + s->sh_name))
                        me->arch.ftrace_trampoline = (void *)s->sh_addr;
#endif
        }

        return 0;
}
```

As we can see above, `module_finalize` invokes `apply_alternatives_module`
to `.altinstructions` section.

What's the content of this section?

## `.altinstructions` section

`__ALTERNATIVE_CFG` pushes `ALTINSTR_ENTRY` into `.altinstructions` section.

```c
        ".pushsection .altinstructions,\"a\"\n"                         \
        ALTINSTR_ENTRY(feature,cb)                                      \
        ".popsection\n"
```

`ALTINSTR_ENTRY` is also a macro.

```c
#define ALTINSTR_ENTRY(feature,cb)                                            \
        " .word 661b - .\n"                             /* label           */ \
        " .if " __stringify(cb) " == 0\n"                                     \
        " .word 663f - .\n"                             /* new instruction */ \
        " .else\n"                                                            \
        " .word " __stringify(cb) "- .\n"               /* callback */        \
        " .endif\n"                                                           \
        " .hword " __stringify(feature) "\n"            /* feature bit     */ \
        " .byte 662b-661b\n"                            /* source len      */ \
        " .byte 664f-663f\n"                            /* replacement len */
```

The corresponding structure in C is `struct alt_instr`.

```c
struct alt_instr {
        s32 orig_offset;        /* offset to original instruction */
        s32 alt_offset;         /* offset to replacement instruction */
        u16 cpufeature;         /* cpufeature bit set for replacement */
        u8  orig_len;           /* size of original instruction(s) */
        u8  alt_len;            /* size of new instruction(s), <= orig_len */
};
```

## The last stage

```c
static void __apply_alternatives(void *alt_region,  bool is_module,
                                 unsigned long *feature_mask)
{
        struct alt_instr *alt;
        struct alt_region *region = alt_region;
        __le32 *origptr, *updptr;
        alternative_cb_t alt_cb;

        for (alt = region->begin; alt < region->end; alt++) {
                int nr_inst;

                if (!test_bit(alt->cpufeature, feature_mask))
                        continue;

                /* Use ARM64_CB_PATCH as an unconditional patch */
                if (alt->cpufeature < ARM64_CB_PATCH &&
                    !cpus_have_cap(alt->cpufeature))
                        continue;

                if (alt->cpufeature == ARM64_CB_PATCH)
                        BUG_ON(alt->alt_len != 0);
                else
                        BUG_ON(alt->alt_len != alt->orig_len);

                pr_info_once("patching kernel code\n");

                origptr = ALT_ORIG_PTR(alt);
                updptr = is_module ? origptr : lm_alias(origptr);
                nr_inst = alt->orig_len / AARCH64_INSN_SIZE;

                if (alt->cpufeature < ARM64_CB_PATCH)
                        alt_cb = patch_alternative;
                else
                        alt_cb  = ALT_REPL_PTR(alt);

                alt_cb(alt, origptr, updptr, nr_inst);

                if (!is_module) {
                        clean_dcache_range_nopatch((u64)origptr,
                                                   (u64)(origptr + nr_inst));
                }
        }

        /*
         * The core module code takes care of cache maintenance in
         * flush_module_icache().
         */
        if (!is_module) {
                dsb(ish);
                __flush_icache_all();
                isb();

                /* Ignore ARM64_CB bit from feature mask */
                bitmap_or(applied_alternatives, applied_alternatives,
                          feature_mask, ARM64_NCAPS);
                bitmap_and(applied_alternatives, applied_alternatives,
                           cpu_hwcaps, ARM64_NCAPS);
        }
}
```

The core is

```c
                if (alt->cpufeature < ARM64_CB_PATCH)
                        alt_cb = patch_alternative;
                else
                        alt_cb  = ALT_REPL_PTR(alt);

                alt_cb(alt, origptr, updptr, nr_inst);
```

In the first example, `kvm_update_va_mask(alt, origptr, updptr, nr_inst)` should
be invoked.