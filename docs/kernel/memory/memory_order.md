# Memory Ordering

If your code interacts directly either with the hardware or
with code executing on other cores, or if it directly loads
or writes instructions to be executed, or modifies page tables,
you need to be aware of memory ordering issues.

The ARMv8 architecture employs a **weakly-ordered** model of
memory. this means that the order of **memory accesses is not**
**required to be the same as the program order for load and**
**store operations**.

## Memory types

`MAIR_ELn` stores the memory types table which is a map from
3-bit index into memory types.

```
/*
 * Default MAIR_EL1. MT_NORMAL_TAGGED is initially mapped as Normal memory and
 * changed during __cpu_setup to Normal Tagged if the system supports MTE.
 */
#define MAIR_EL1_SET                                                    \
        (MAIR_ATTRIDX(MAIR_ATTR_DEVICE_nGnRnE, MT_DEVICE_nGnRnE) |      \
         MAIR_ATTRIDX(MAIR_ATTR_DEVICE_nGnRE, MT_DEVICE_nGnRE) |        \
         MAIR_ATTRIDX(MAIR_ATTR_DEVICE_GRE, MT_DEVICE_GRE) |            \
         MAIR_ATTRIDX(MAIR_ATTR_NORMAL_NC, MT_NORMAL_NC) |              \
         MAIR_ATTRIDX(MAIR_ATTR_NORMAL, MT_NORMAL) |                    \
         MAIR_ATTRIDX(MAIR_ATTR_NORMAL_WT, MT_NORMAL_WT) |              \
         MAIR_ATTRIDX(MAIR_ATTR_NORMAL, MT_NORMAL_TAGGED))
```

```c
        mov_q   mair, MAIR_EL1_SET
```

TLB entry stores the 3-bit index.

```c
/*
 * Memory types available.
 *
 * IMPORTANT: MT_NORMAL must be index 0 since vm_get_page_prot() may 'or' in
 *            the MT_NORMAL_TAGGED memory type for PROT_MTE mappings. Note
 *            that protection_map[] only contains MT_NORMAL attributes.
 */
#define MT_NORMAL               0
#define MT_NORMAL_TAGGED        1
#define MT_NORMAL_NC            2
#define MT_NORMAL_WT            3
#define MT_DEVICE_nGnRnE        4
#define MT_DEVICE_nGnRE         5
#define MT_DEVICE_GRE           6

#define PROT_DEVICE_nGnRnE      (PROT_DEFAULT | PTE_PXN | PTE_UXN | PTE_WRITE | PTE_ATTRINDX(MT_DEVICE_nGnRnE))
#define PROT_DEVICE_nGnRE       (PROT_DEFAULT | PTE_PXN | PTE_UXN | PTE_WRITE | PTE_ATTRINDX(MT_DEVICE_nGnRE))
#define PROT_NORMAL_NC          (PROT_DEFAULT | PTE_PXN | PTE_UXN | PTE_WRITE | PTE_ATTRINDX(MT_NORMAL_NC))
#define PROT_NORMAL_WT          (PROT_DEFAULT | PTE_PXN | PTE_UXN | PTE_WRITE | PTE_ATTRINDX(MT_NORMAL_WT))
#define PROT_NORMAL             (PROT_DEFAULT | PTE_PXN | PTE_UXN | PTE_WRITE | PTE_ATTRINDX(MT_NORMAL))
#define PROT_NORMAL_TAGGED      (PROT_DEFAULT | PTE_PXN | PTE_UXN | PTE_WRITE | PTE_ATTRINDX(MT_NORMAL_TAGGED))
```

* G(Gathering)
* R(Re-order)
* E(Early Write Acknowledgement)

### Normal memory

You can use Normal memory for all code and for most data regions in memory.

The processor can **re-order, repeat, and merge accesses** to Normal memory.

Furthermore, address locations that are marked as Normal can be accessed
speculatively by the processor, so that data or instructions can be read
from memory without being explicitly referenced in the program, or in advance
of the actual execution of an explicit reference.

**Normal memory implements a weakly-ordered memory mode.**

### Device memory

You can use Device memory for all memory regions where an access might
have a side-effect.

## Barriers

The ARM architecture includes barrier instructions to force access
ordering and access completion at a specific point.

There are three types of barrier instruction provided by the architecture:
* isb
* dmb
* dsb