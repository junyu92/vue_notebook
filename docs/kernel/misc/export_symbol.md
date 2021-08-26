# Export Kernel Symbol

## Modversion

```c
#ifdef CONFIG_MODVERSIONS
/* Mark the CRC weak since genksyms apparently decides not to
 * generate a checksums for some symbols */
#if defined(CONFIG_MODULE_REL_CRCS)
#define __CRC_SYMBOL(sym, sec)                                          \
        asm("   .section \"___kcrctab" sec "+" #sym "\", \"a\"  \n"     \
            "   .weak   __crc_" #sym "                          \n"     \
            "   .long   __crc_" #sym " - .                      \n"     \
            "   .previous                                       \n")
#else
#define __CRC_SYMBOL(sym, sec)                                          \
        asm("   .section \"___kcrctab" sec "+" #sym "\", \"a\"  \n"     \
            "   .weak   __crc_" #sym "                          \n"     \
            "   .long   __crc_" #sym "                          \n"     \
            "   .previous                                       \n")
#endif
#else
#define __CRC_SYMBOL(sym, sec)
#endif
```

## EXPORT_SYMBOL

In this chapter, we are going to analyze `EXPORT_SYMBOL`.



### Macro

```c
#define __ADDRESSABLE(sym) \
        static void * __section(".discard.addressable") __used \
                __PASTE(__addressable_##sym, __LINE__) = (void *)&sym;

#define __KSYMTAB_ENTRY(sym, sec)                                       \
        static const struct kernel_symbol __ksymtab_##sym               \
        __attribute__((section("___ksymtab" sec "+" #sym), used))       \
        = { (unsigned long)&sym, __kstrtab_##sym }

/* For every exported symbol, place a struct in the __ksymtab section */
#define ___EXPORT_SYMBOL(sym, sec)                                      \
        extern typeof(sym) sym;                                         \
        __CRC_SYMBOL(sym, sec)                                          \
        static const char __kstrtab_##sym[]                             \
        __attribute__((section("__ksymtab_strings"), used, aligned(1))) \
        = #sym;                                                         \
        __KSYMTAB_ENTRY(sym, sec)

#define __EXPORT_SYMBOL ___EXPORT_SYMBOL

#define EXPORT_SYMBOL(sym)                                      \
        __EXPORT_SYMBOL(sym, "")

#define EXPORT_SYMBOL_GPL(sym)                                  \
        __EXPORT_SYMBOL(sym, "_gpl")

#define EXPORT_SYMBOL_GPL_FUTURE(sym)                           \
        __EXPORT_SYMBOL(sym, "_gpl_future")
```

For each exported symbol, al least the following is defined by EXPORT_SYMBOL():

* `__kstrtab_<symbol_name>` - name of the symbol as a string

* `__ksymtab_<symbol_name>` - a structure with the information
  about the symbol: its address, address of `__kstrtab_<symbol_name>`, etc.
  It is typed with `struct kernel_symbol`

```c
struct kernel_symbol {
        unsigned long value;
        const char *name;
};
```

`value` is the address of the symbol. `name` is the aforementioned
variable `kstrtab_sym`.

* `__kcrctab_<symbol_name>` - address of the control sum (CRC) of the
  symbol - it is used, for example, to check if the kernel or a module
  provides an exactly the same symbol as needed by a given kernel module.
  If a module requires a symbol with a given name and CRC and the kernel
  provides a symbol with that name but a different CRC (e.g. if the module
  was compiled for a different kernel version), the module loader will
  refuse to load that kernel module (unless this check is disabled).

These variables are stored in different section, `kstrtab_{sym}` is putting
whthin section `__ksymtab_strings` and `ksymtab+<sym>` is putting within
section `___ksymtab`.

:::tip
Assume that we export a symbol via

```c
EXPORT_SYMBOL(vectors)
```

Expand it we can get

```c
extern char vectors[];
extern typeof(vectors) vectors;
asm("   .section \"___kcrctab+vectors\", \"a\"  \n"
    "   .weak   __crc_vectors                   \n"
    "   .long   __crc_vectors                   \n"
    "   .previous                               \n");
static const char __kstrtab_vectors[]
__attribute__((section("__ksymtab_strings"), used, aligned(1))) =
                "vectors";
static void *__attribute__((__section__(".discard.addressable")))
__attribute__((__used__)) __addressable_vectors55 = (void *)&vectors;
asm("   .section \"___ksymtab+vectors\", \"a\"          \n"
    "   .balign 4                                       \n"
    "__ksymtab_vectors:                                 \n"
    "   .long   vectors - .                             \n"
    "   .long   __kstrtab_vectors - .                   \n"
    "   .long   0                                       \n"
    "   .previous                                       \n");
```
:::

### Linking

Variables declared by `EXPORT_SYMBOL` are linked into `vmlinux`.

```c
// include/asm-generic/vmlinux.lds.h
        /* Kernel symbol table: strings */                              \
        __ksymtab_strings : AT(ADDR(__ksymtab_strings) - LOAD_OFFSET) { \
                *(__ksymtab_strings)                                    \
        }

        /* Kernel symbol table: Normal symbols */                       \
        __ksymtab         : AT(ADDR(__ksymtab) - LOAD_OFFSET) {         \
                __start___ksymtab = .;                                  \
                KEEP(*(SORT(___ksymtab+*)))                             \
                __stop___ksymtab = .;                                   \
        }                                                               \
```

For example.

```
# readelf -a vmlinux
      38n: ffff00001102e640     0 NOTYPE  LOCAL  DEFAULT    5 __ksymtab_irq_stat
      389: ffff00001103fb52     9 OBJECT  LOCAL  DEFAULT    7 __kstrtab_irq_stat
   137299: ffff0000111cf380    64 OBJECT  GLOBAL DEFAULT   17 irq_stat
```

### Resolve undefined symbol for Module

```c
static int simplify_symbols(struct module *mod, const struct load_info *info)
{
        Elf_Shdr *symsec = &info->sechdrs[info->index.sym];
        Elf_Sym *sym = (void *)symsec->sh_addr;
        unsigned long secbase;
        unsigned int i;
        int ret = 0;
        const struct kernel_symbol *ksym;

        for (i = 1; i < symsec->sh_size / sizeof(Elf_Sym); i++) {
                // ...

                case SHN_UNDEF:
                        ksym = resolve_symbol_wait(mod, info, name);
                        /* Ok if resolved.  */
                        if (ksym && !IS_ERR(ksym)) {
                                sym[i].st_value = kernel_symbol_value(ksym);
                                break;
                        }

                        /* Ok if weak.  */
                        if (!ksym && ELF_ST_BIND(sym[i].st_info) == STB_WEAK)
                                break;

                        ret = PTR_ERR(ksym) ?: -ENOENT;
                        pr_warn("%s: Unknown symbol %s (err %d)\n",
                                mod->name, name, ret);
                        break;

                // ...
        }

        return ret;
```

## Question

1. `EXPORT_SYMBOL` works fine in `.c` but fails in `.S` and the fail message is
   ``relocation R_AARCH64_ABS32 against `__crc_<symbol>' can not be used when making a shared object``

`ld -shared hello.o` doesn't allow weak symbol in `hello.o`, however `EXPORT_SYMBOL` generates
a weak symbol `__crc_<symbol>>`.

Both '.c' and '.S' are compiled with gcc.

```
gcc -Wp,-MD,arch/arm64/mm/.mmu.o.d  -nostdinc -isystem /usr/lib/gcc/aarch64-linux-gnu/8/include -I./arch/arm64/include -I./arch/arm64/include/generated  -I./include -I./arch/arm64/include/uapi -I./arch/arm64/include/generated/uapi -I./include/uapi -I./include/generated/uapi -include ./include/linux/kconfig.h -include ./include/linux/compiler_types.h -D__KERNEL__ -mlittle-endian -DKASAN_SHADOW_SCALE_SHIFT=3 -Wall -Wundef -Werror=strict-prototypes -Wno-trigraphs -fno-strict-aliasing -fno-common -fshort-wchar -fno-PIE -Werror=implicit-function-declaration -Werror=implicit-int -Wno-format-security -std=gnu89 -mgeneral-regs-only -DCONFIG_AS_LSE=1 -DCONFIG_CC_HAS_K_CONSTRAINT=1 -fno-asynchronous-unwind-tables -Wno-psabi -mabi=lp64 -DKASAN_SHADOW_SCALE_SHIFT=3 -fno-delete-null-pointer-checks -Wno-frame-address -Wno-format-truncation -Wno-format-overflow -O2 --param=allow-store-data-races=0 -Wframe-larger-than=2048 -fstack-protector-strong -Wno-unused-but-set-variable -Wimplicit-fallthrough -Wno-unused-const-variable -fno-omit-frame-pointer -fno-optimize-sibling-calls -fno-var-tracking-assignments -g -pg -Wdeclaration-after-statement -Wvla -Wno-pointer-sign -Wno-stringop-truncation -Wno-array-bounds -Wno-stringop-overflow -Wno-restrict -Wno-maybe-uninitialized -fno-strict-overflow -fno-merge-all-constants -fmerge-constants -fno-stack-check -fconserve-stack -Werror=date-time -Werror=incompatible-pointer-types -Werror=designated-init -fmacro-prefix-map=./= -Wno-packed-not-aligned    -DKBUILD_BASENAME='"mmu"' -DKBUILD_MODNAME='"mmu"' -c -o arch/arm64/mm/mmu.o arch/arm64/mm/mmu.c
```

Nonetheless there is an extra stage for compiling. This stage resolves
weak symbol for the object of '.c' but don't resolve for the object of
'.S'. I don't know why.

```
if objdump -h arch/arm64/mm/mmu.o | grep -q __ksymtab; then gcc -E -D__GENKSYMS__ -Wp,-MD,arch/arm64/mm/.mmu.o.d  -nostdinc -isystem /usr/lib/gcc/aarch64-linux-gnu/8/include -I./arch/arm64/include -I./arch/arm64/include/generated  -I./include -I./arch/arm64/include/uapi -I./arch/arm64/include/generated/uapi -I./include/uapi -I./include/generated/uapi -include ./include/linux/kconfig.h -include ./include/linux/compiler_types.h -D__KERNEL__ -mlittle-endian -DKASAN_SHADOW_SCALE_SHIFT=3 -Wall -Wundef -Werror=strict-prototypes -Wno-trigraphs -fno-strict-aliasing -fno-common -fshort-wchar -fno-PIE -Werror=implicit-function-declaration -Werror=implicit-int -Wno-format-security -std=gnu89 -mgeneral-regs-only -DCONFIG_AS_LSE=1 -DCONFIG_CC_HAS_K_CONSTRAINT=1 -fno-asynchronous-unwind-tables -Wno-psabi -mabi=lp64 -DKASAN_SHADOW_SCALE_SHIFT=3 -fno-delete-null-pointer-checks -Wno-frame-address -Wno-format-truncation -Wno-format-overflow -O2 --param=allow-store-data-races=0 -Wframe-larger-than=2048 -fstack-protector-strong -Wno-unused-but-set-variable -Wimplicit-fallthrough -Wno-unused-const-variable -fno-omit-frame-pointer -fno-optimize-sibling-calls -fno-var-tracking-assignments -g -pg -Wdeclaration-after-statement -Wvla -Wno-pointer-sign -Wno-stringop-truncation -Wno-array-bounds -Wno-stringop-overflow -Wno-restrict -Wno-maybe-uninitialized -fno-strict-overflow -fno-merge-all-constants -fmerge-constants -fno-stack-check -fconserve-stack -Werror=date-time -Werror=incompatible-pointer-types -Werror=designated-init -fmacro-prefix-map=./= -Wno-packed-not-aligned    -DKBUILD_BASENAME='"mmu"' -DKBUILD_MODNAME='"mmu"' arch/arm64/mm/mmu.c | scripts/genksyms/genksyms    -r /dev/null > arch/arm64/mm/.tmp_mmu.ver; ld  -EL  -maarch64elf -r -o arch/arm64/mm/.tmp_mmu.o arch/arm64/mm/mmu.o -T arch/arm64/mm/.tmp_mmu.ver; mv -f arch/arm64/mm/.tmp_mmu.o arch/arm64/mm/mmu.o; rm -f arch/arm64/mm/.tmp_mmu.ver; fi
```

## Reference

> https://stackoverflow.com/questions/18487032/what-is-ksymtab-in-linux-kernel