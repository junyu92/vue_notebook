# EXPORT_SYMBOL

In this chapter, we are going to analyze `EXPORT_SYMBOL`.

## Macro

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

It defines two variable `kstrtab_sym` and `ksymtab_sym`.

The first one is just a string containing the name of the symbol.
The second one defins a variable with type `struct kernel_symbol`.

```c
struct kernel_symbol {
        unsigned long value;
        const char *name;
};
```

`value` is the address of the symbol. `name` is the aforementioned
variable `kstrtab_sym`.

These variables are stored in different section, `kstrtab_{sym}` is putting
in section `__ksymtab_strings` and `ksymtab_sym` is putting in
section `___ksymtab`.

## Linking

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

## Resolve undefined symbol for Module

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