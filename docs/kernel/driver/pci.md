# PCI

## PCI Configuration Space

### Base Address Register (BAR)

It's used to
* specify how much memory a device wants to be mapped into main memory
* after device enumeration, it holds the (base) addresses, where the mapped
  memory block begins

### MSI-X capability

```
| 31                       | 15                        | 7     | 2 | 0 |
| ------------------------ | ------------------------- | ----- | ----- |
|       Message Control    |  Next Capability Pointer  | Capability ID |
|                                Table Offset                  |  BIR  |
|                                PBA Offset                    |  BIR  |
```

**MSI-X Control Register**

* Bits[10:0]: MSI-X Table Size, Encoded as (Table Size - 1)
* Bit[14]: Function Mask.
  * 1: All vectors associated with the function are masked
  * 0: Each vector's Mask bit determines whether the vector
    is masked or not
* Bit[15]: MSI-X Enable

**Table Offset and BIR**

* Bits[2:0]: Table BAR Indicator Register(BIR), indicates which BAR is
  used to map the MSI-X Table into memory space:
  * 000: BAR0
  * 001: BAR1
  * 010: BAR2
  * 011: BAR3
  * 100: BAR4
  * 101: BAR5
  * 110: Reserved
  * 111: Reserved
* Bits[31:3]: Table Offset, which is the base address of the MSI-X Table,
  as an offset from the base address of the BAR indicated by the Table
  BIT bits

Linux returns the physical address of **MSI-X Table** and maps it to
virtual address via method `msix_map_region`.


## Linux

### PCI Bus

```c
struct pci_bus {
        struct list_head node;          /* Node in list of buses */
        struct pci_bus  *parent;        /* Parent bus this bridge is on */
        struct list_head children;      /* List of child buses */
        struct list_head devices;       /* List of devices on this bus */
        struct pci_dev  *self;          /* Bridge device as seen by parent */
        struct list_head slots;         /* List of slots on this bus;
                                           protected by pci_slot_mutex */
        struct resource *resource[PCI_BRIDGE_RESOURCE_NUM];
        struct list_head resources;     /* Address space routed to this bus */
        struct resource busn_res;       /* Bus numbers routed to this bus */

        struct pci_ops  *ops;           /* Configuration access functions */
        struct msi_controller *msi;     /* MSI controller */
        void            *sysdata;       /* Hook for sys-specific extension */
        struct proc_dir_entry *procdir; /* Directory entry in /proc/bus/pci */

        unsigned char   number;         /* Bus number */
        unsigned char   primary;        /* Number of primary bridge */
        unsigned char   max_bus_speed;  /* enum pci_bus_speed */
        unsigned char   cur_bus_speed;  /* enum pci_bus_speed */
#ifdef CONFIG_PCI_DOMAINS_GENERIC
        int             domain_nr;
#endif

        char            name[48];

        unsigned short  bridge_ctl;     /* Manage NO_ISA/FBB/et al behaviors */
        pci_bus_flags_t bus_flags;      /* Inherited by child buses */
        struct device           *bridge;
        struct device           dev;
        struct bin_attribute    *legacy_io;     /* Legacy I/O for this bus */
        struct bin_attribute    *legacy_mem;    /* Legacy mem */
        unsigned int            is_added:1;
};
```

### msi_desc

```c
/**
 * struct msi_desc - Descriptor structure for MSI based interrupts
 * @list:       List head for management
 * @irq:        The base interrupt number
 * @nvec_used:  The number of vectors used
 * @dev:        Pointer to the device which uses this descriptor
 * @msg:        The last set MSI message cached for reuse
 * @affinity:   Optional pointer to a cpu affinity mask for this descriptor
 *
 * @masked:     [PCI MSI/X] Mask bits
 * @is_msix:    [PCI MSI/X] True if MSI-X
 * @multiple:   [PCI MSI/X] log2 num of messages allocated
 * @multi_cap:  [PCI MSI/X] log2 num of messages supported
 * @maskbit:    [PCI MSI/X] Mask-Pending bit supported?
 * @is_64:      [PCI MSI/X] Address size: 0=32bit 1=64bit
 * @entry_nr:   [PCI MSI/X] Entry which is described by this descriptor
 * @default_irq:[PCI MSI/X] The default pre-assigned non-MSI irq
 * @mask_pos:   [PCI MSI]   Mask register position
 * @mask_base:  [PCI MSI-X] Mask register base address
 * @platform:   [platform]  Platform device specific msi descriptor data
 * @fsl_mc:     [fsl-mc]    FSL MC device specific msi descriptor data
 */
struct msi_desc {
        /* Shared device/bus type independent data */
        struct list_head                list;
        unsigned int                    irq;
        unsigned int                    nvec_used;
        struct device                   *dev;
        struct msi_msg                  msg;
        struct irq_affinity_desc        *affinity;

        union {
                /* PCI MSI/X specific data */
                struct {
                        u32 masked;
                        struct {
                                __u8    is_msix         : 1;
                                __u8    multiple        : 3;
                                __u8    multi_cap       : 3;
                                __u8    maskbit         : 1;
                                __u8    is_64           : 1;
                                __u16   entry_nr;
                                unsigned default_irq;
                        } msi_attrib;
                        union {
                                u8      mask_pos;
                                void __iomem *mask_base;
                        };
                };

                /*
                 * Non PCI variants add their data structure here. New
                 * entries need to use a named structure. We want
                 * proper name spaces for this. The PCI part is
                 * anonymous for now as it would require an immediate
                 * tree wide cleanup.
                 */
                struct platform_msi_desc platform;
                struct fsl_mc_msi_desc fsl_mc;
        };
};
```

### PCI Device

```c
/* The pci_dev structure describes PCI devices */
struct pci_dev {
        struct list_head bus_list;      /* Node in per-bus list */
        struct pci_bus  *bus;           /* Bus this device is on */
        struct pci_bus  *subordinate;   /* Bus this device bridges to */

        void            *sysdata;       /* Hook for sys-specific extension */
        struct proc_dir_entry *procent; /* Device entry in /proc/bus/pci */
        struct pci_slot *slot;          /* Physical slot this device is in */

        unsigned int    devfn;          /* Encoded device & function index */
        unsigned short  vendor;
        unsigned short  device;
        unsigned short  subsystem_vendor;
        unsigned short  subsystem_device;
        unsigned int    class;          /* 3 bytes: (base,sub,prog-if) */
        u8              revision;       /* PCI revision, low byte of class word */
        u8              hdr_type;       /* PCI header type (`multi' flag masked out) */
#ifdef CONFIG_PCIEAER
        u16             aer_cap;        /* AER capability offset */
        struct aer_stats *aer_stats;    /* AER stats for this device */
#endif
        u8              pcie_cap;       /* PCIe capability offset */
        u8              msi_cap;        /* MSI capability offset */
        u8              msix_cap;       /* MSI-X capability offset */
        u8              pcie_mpss:3;    /* PCIe Max Payload Size Supported */
        u8              rom_base_reg;   /* Config register controlling ROM */
        u8              pin;            /* Interrupt pin this device uses */
        u16             pcie_flags_reg; /* Cached PCIe Capabilities Register */
        unsigned long   *dma_alias_mask;/* Mask of enabled devfn aliases */

        struct pci_driver *driver;      /* Driver bound to this device */
        u64             dma_mask;       /* Mask of the bits of bus address this
                                           device implements.  Normally this is
                                           0xffffffff.  You only need to change
                                           this if your device has broken DMA
                                           or supports 64-bit transfers.  */

        struct device_dma_parameters dma_parms;

        pci_power_t     current_state;  /* Current operating state. In ACPI,
                                           this is D0-D3, D0 being fully
                                           functional, and D3 being off. */
        unsigned int    imm_ready:1;    /* Supports Immediate Readiness */
        u8              pm_cap;         /* PM capability offset */
        unsigned int    pme_support:5;  /* Bitmask of states from which PME#
                                           can be generated */
        unsigned int    pme_poll:1;     /* Poll device's PME status bit */
        unsigned int    d1_support:1;   /* Low power state D1 is supported */
        unsigned int    d2_support:1;   /* Low power state D2 is supported */
        unsigned int    no_d1d2:1;      /* D1 and D2 are forbidden */
        unsigned int    no_d3cold:1;    /* D3cold is forbidden */
        unsigned int    bridge_d3:1;    /* Allow D3 for bridge */
        unsigned int    d3cold_allowed:1;       /* D3cold is allowed by user */
        unsigned int    mmio_always_on:1;       /* Disallow turning off io/mem
                                                   decoding during BAR sizing */
        unsigned int    wakeup_prepared:1;
        unsigned int    runtime_d3cold:1;       /* Whether go through runtime
                                                   D3cold, not set for devices
                                                   powered on/off by the
                                                   corresponding bridge */
        unsigned int    ignore_hotplug:1;       /* Ignore hotplug events */
        unsigned int    hotplug_user_indicators:1; /* SlotCtl indicators
                                                      controlled exclusively by
                                                      user sysfs */
        unsigned int    d3_delay;       /* D3->D0 transition time in ms */
        unsigned int    d3cold_delay;   /* D3cold->D0 transition time in ms */

#ifdef CONFIG_PCIEASPM
        struct pcie_link_state  *link_state;    /* ASPM link state */
        unsigned int    ltr_path:1;     /* Latency Tolerance Reporting
                                           supported from root to here */
#endif
        unsigned int    eetlp_prefix_path:1;    /* End-to-End TLP Prefix */

        pci_channel_state_t error_state;        /* Current connectivity state */
        struct device   dev;                    /* Generic device interface */

        int             cfg_size;               /* Size of config space */

        /*
         * Instead of touching interrupt line and base address registers
         * directly, use the values stored here. They might be different!
         */
        unsigned int    irq;
        struct resource resource[DEVICE_COUNT_RESOURCE]; /* I/O and memory regions + expansion ROMs */

        bool            match_driver;           /* Skip attaching driver */

        unsigned int    transparent:1;          /* Subtractive decode bridge */
        unsigned int    multifunction:1;        /* Multi-function device */

        unsigned int    is_busmaster:1;         /* Is busmaster */
        unsigned int    no_msi:1;               /* May not use MSI */
        unsigned int    no_64bit_msi:1;         /* May only use 32-bit MSIs */
        unsigned int    block_cfg_access:1;     /* Config space access blocked */
        unsigned int    broken_parity_status:1; /* Generates false positive parity */
        unsigned int    irq_reroute_variant:2;  /* Needs IRQ rerouting variant */
        unsigned int    msi_enabled:1;
        unsigned int    msix_enabled:1;
        unsigned int    ari_enabled:1;          /* ARI forwarding */
        unsigned int    ats_enabled:1;          /* Address Translation Svc */
        unsigned int    pasid_enabled:1;        /* Process Address Space ID */
        unsigned int    pri_enabled:1;          /* Page Request Interface */
        unsigned int    is_managed:1;
        unsigned int    needs_freset:1;         /* Requires fundamental reset */
        unsigned int    state_saved:1;
        unsigned int    is_physfn:1;
        unsigned int    is_virtfn:1;
        unsigned int    reset_fn:1;
        unsigned int    is_hotplug_bridge:1;
        unsigned int    shpc_managed:1;         /* SHPC owned by shpchp */
        unsigned int    is_thunderbolt:1;       /* Thunderbolt controller */
        /*
         * Devices marked being untrusted are the ones that can potentially
         * execute DMA attacks and similar. They are typically connected
         * through external ports such as Thunderbolt but not limited to
         * that. When an IOMMU is enabled they should be getting full
         * mappings to make sure they cannot access arbitrary memory.
         */
        unsigned int    untrusted:1;
        unsigned int    __aer_firmware_first_valid:1;
        unsigned int    __aer_firmware_first:1;
        unsigned int    broken_intx_masking:1;  /* INTx masking can't be used */
        unsigned int    io_window_1k:1;         /* Intel bridge 1K I/O windows */
        unsigned int    irq_managed:1;
        unsigned int    has_secondary_link:1;
        unsigned int    non_compliant_bars:1;   /* Broken BARs; ignore them */
        unsigned int    is_probed:1;            /* Device probing in progress */
        unsigned int    link_active_reporting:1;/* Device capable of reporting link active */
        unsigned int    no_vf_scan:1;           /* Don't scan for VFs after IOV enablement */
        pci_dev_flags_t dev_flags;
        atomic_t        enable_cnt;     /* pci_enable_device has been called */

        u32             saved_config_space[16]; /* Config space saved at suspend time */
        struct hlist_head saved_cap_space;
        struct bin_attribute *rom_attr;         /* Attribute descriptor for sysfs ROM entry */
        int             rom_attr_enabled;       /* Display of ROM attribute enabled? */
        struct bin_attribute *res_attr[DEVICE_COUNT_RESOURCE]; /* sysfs file for resources */
        struct bin_attribute *res_attr_wc[DEVICE_COUNT_RESOURCE]; /* sysfs file for WC mapping of resources */

#ifdef CONFIG_HOTPLUG_PCI_PCIE
        unsigned int    broken_cmd_compl:1;     /* No compl for some cmds */
#endif
#ifdef CONFIG_PCIE_PTM
        unsigned int    ptm_root:1;
        unsigned int    ptm_enabled:1;
        u8              ptm_granularity;
#endif
#ifdef CONFIG_PCI_MSI
        const struct attribute_group **msi_irq_groups;
#endif
        struct pci_vpd *vpd;
#ifdef CONFIG_PCI_ATS
        union {
                struct pci_sriov        *sriov;         /* PF: SR-IOV info */
                struct pci_dev          *physfn;        /* VF: related PF */
        };
        u16             ats_cap;        /* ATS Capability offset */
        u8              ats_stu;        /* ATS Smallest Translation Unit */
        atomic_t        ats_ref_cnt;    /* Number of VFs with ATS enabled */
#endif
#ifdef CONFIG_PCI_PRI
        u32             pri_reqs_alloc; /* Number of PRI requests allocated */
#endif
#ifdef CONFIG_PCI_PASID
        u16             pasid_features;
#endif
#ifdef CONFIG_PCI_P2PDMA
        struct pci_p2pdma *p2pdma;
#endif
        phys_addr_t     rom;            /* Physical address if not from BAR */
        size_t          romlen;         /* Length if not from BAR */
        char            *driver_override; /* Driver name to force a match */

        unsigned long   priv_flags;     /* Private flags for the PCI driver */
};
```

## PCI Structure from QEMU view

Let's create a VM and see its topology.

```bash
qemu-system-aarch64 \
	-machine virt-2.12,accel=kvm,usb=off,dump-guest-core=off,gic-version=host \
	-device pcie-root-port,port=0x8,chassis=1,id=pci.1,bus=pcie.0,multifunction=on,addr=0x1 \
	-device pcie-root-port,port=0x9,chassis=2,id=pci.2,bus=pcie.0,addr=0x1.0x1 \
	-device pcie-root-port,port=0xa,chassis=3,id=pci.3,bus=pcie.0,addr=0x1.0x2 \
	-device pcie-root-port,port=0xb,chassis=4,id=pci.4,bus=pcie.0,addr=0x1.0x3 \
	-device pcie-root-port,port=0xc,chassis=5,id=pci.5,bus=pcie.0,addr=0x1.0x4 \
	-device virtio-scsi-pci,id=scsi0,bus=pci.3,addr=0x0 \
	-device vfio-pci,host=82:00.0,id=hostdev0,bus=pci.5,addr=0x0
```

```
$ lshw

machine
    description: Computer
    width: 64 bits
    capabilities: cp15_barrier setend swp tagged_addr_disabled
  *-core
       description: Motherboard
       physical id: 0
     *-memory
          description: System memory
          physical id: 0
          size: 4GiB
     *-cpu
          physical id: 1
          bus info: cpu@0
          capabilities: fp asimd evtstrm aes pmull sha1 sha2 crc32 atomics fphp asimdhp cpuid asimdrdm jscvt fcma dcpop asimddp asimdfhm
     *-pci
          description: Host bridge
          product: QEMU PCIe Host bridge
          vendor: Red Hat, Inc.
          physical id: 100
          bus info: pci@0000:00:00.0
          version: 00
          width: 32 bits
          clock: 33MHz
        *-pci:0
             description: PCI bridge
             product: QEMU PCIe Root port
             vendor: Red Hat, Inc.
             physical id: 1
             bus info: pci@0000:00:01.0
             version: 00
             width: 32 bits
             clock: 33MHz
             capabilities: pci normal_decode bus_master cap_list
             configuration: driver=pcieport
             resources: irq:38 memory:10a00000-10a00fff ioport:1000(size=4096) memory:10000000-101fffff ioport:8000000000(size=2097152)
        *-pci:1
             description: PCI bridge
             product: QEMU PCIe Root port
             vendor: Red Hat, Inc.
             physical id: 1.1
             bus info: pci@0000:00:01.1
             version: 00
             width: 32 bits
             clock: 33MHz
             capabilities: pci normal_decode bus_master cap_list
             configuration: driver=pcieport
             resources: irq:38 memory:10a01000-10a01fff ioport:2000(size=4096) memory:10200000-103fffff ioport:8000200000(size=2097152)
        *-pci:2
             description: PCI bridge
             product: QEMU PCIe Root port
             vendor: Red Hat, Inc.
             physical id: 1.2
             bus info: pci@0000:00:01.2
             version: 00
             width: 32 bits
             clock: 33MHz
             capabilities: pci normal_decode bus_master cap_list
             configuration: driver=pcieport
             resources: irq:38 memory:10a02000-10a02fff ioport:3000(size=4096) memory:10400000-105fffff ioport:8000400000(size=2097152)
           *-scsi
                description: SCSI storage controller
                product: Virtio SCSI
                vendor: Red Hat, Inc.
                physical id: 0
                bus info: pci@0000:03:00.0
                version: 01
                width: 64 bits
                clock: 33MHz
                capabilities: scsi bus_master cap_list
                configuration: driver=virtio-pci latency=0
                resources: iomemory:800-7ff irq:38 memory:10400000-10400fff memory:8000400000-8000403fff
              *-virtio0 UNCLAIMED
                   description: Virtual I/O device
                   physical id: 0
                   bus info: virtio@0
                   configuration: driver=virtio_scsi
        *-pci:3
             description: PCI bridge
             product: QEMU PCIe Root port
             vendor: Red Hat, Inc.
             physical id: 1.3
             bus info: pci@0000:00:01.3
             version: 00
             width: 32 bits
             clock: 33MHz
             capabilities: pci normal_decode bus_master cap_list
             configuration: driver=pcieport
             resources: irq:38 memory:10a03000-10a03fff ioport:4000(size=4096) memory:10600000-107fffff ioport:8000600000(size=2097152)
        *-pci:4
             description: PCI bridge
             product: QEMU PCIe Root port
             vendor: Red Hat, Inc.
             physical id: 1.4
             bus info: pci@0000:00:01.4
             version: 00
             width: 32 bits
             clock: 33MHz
             capabilities: pci normal_decode bus_master cap_list
             configuration: driver=pcieport
             resources: irq:38 memory:10a04000-10a04fff ioport:5000(size=4096) memory:10800000-109fffff ioport:8000800000(size=2097152)
           *-storage
                description: Non-Volatile memory controller
                product: NVMe SSD Controller SM981/PM981/PM983
                vendor: Samsung Electronics Co Ltd
                physical id: 0
                bus info: pci@0000:05:00.0
                version: 00
                width: 64 bits
                clock: 33MHz
                capabilities: storage nvm_express bus_master cap_list rom
                configuration: driver=nvme latency=0
                resources: irq:38 memory:10810000-10813fff memory:10800000-1080ffff
              *-nvme0
                   description: NVMe device
                   product: SAMSUNG MZQLB1T9HAJR-00003
                   physical id: 0
                   logical name: /dev/nvme0
                   version: EDA5700Q
                   serial: S480NE0MB00360
                   configuration: nqn=nqn.2014.08.org.nvmexpress:144d144dS480NE0MB00360      SAMSUNG MZQLB1T9HAJR-00003 state=live
                 *-namespace
                      description: NVMe namespace
                      physical id: 1
                      logical name: /dev/nvme0n1
```


```
        +-----------------------------------------------------------------+
        |                   PCI Host bridge                               |
        +-----------------------------------------------------------------+
            ^             ^              ^              ^             ^
            |             |              |              |             |
            V             V              V              V             V
    +---------------------------------------------------------------------------+
    |                               Bus                                         |
    +---------------------------------------------------------------------------+
            ^             ^              ^              ^             ^
            |             |              |              |             |
            V             V              V              V             V
      +-----------+ +-----------+  +-----------+  +-----------+  +-----------+
      | root port | | root port |  | root port |  | root port |  | root port |
      |   pci.0   | |   pci.1   |  |   pci.2   |  |   pci.3   |  |   pci.4   |
      +-----------+ +-----------+  +-----------+  +-----------+  +-----------+
                                                                       ^
                                                                       |
                                                                       V
                                                                 +-----------+
                                                                 |  Bus      |
                                                                 +-----------+
                                                                       ^
                                                                       |
                                                                       V
                                                                 +-----------+
                                                                 |  storage  |
                                                                 +-----------+
```

## MSI

### Introduction

A Message Signaled Interrupt is a write from the device to a special
address which causes an interrupt to be received by the CPU.

The MSI capability was first specified in PCI 2.2 and was later
enhanced in PCI 3.0 to allow each interrupt to be masked individually.
The MSI-X capability was also introduced with PCI 3.0. It supports
more interrupts per device than MSI and allows interrupts to be
independently configured.

Devices may support both MSI and MSI-X,
**but only one can be enabled at a time.**

### MSI and MSIX

MSI and MSI-X are PCI capabilities. Both are "Message Signaled Interrupts"
which deliver interrupts to the CPU via a DMA write to a Local APIC.
The fundamental difference between MSI and MSI-X is how multiple
"vectors" get allocated. MSI requires contiguous blocks of vectors
while MSI-X can allocate several individual ones.

MSI capability can be enabled by calling `pci_alloc_irq_vectors()` with the
`PCI_IRQ_MSI` and/or `PCI_IRQ_MSIX` flags before calling request_irq(). This
causes the PCI support to program CPU vector data into the PCI device
capability registers.

Advantages:

* MSI is an exclusive interrupt vector by definition. This means the
  interrupt handler doesn't have to verify its device caused the
  interrupt.
* MSI avoids DMA/IRQ race conditions. DMA to host memory is guaranteed
  to be visible to the host CPU(s) when the MSI is delivered. This is
  important for both data conherency and avoiding state control data.
  This guarantee allows the driver to omit MMIO reads to flush the
  DMA stream.
* PCI devices can only support a single pin-based interrupt per function.
  Often drivers have to query the devices to find out what event has
  occurred, slowing down interrupt handling for the common case.

### How to use MSIs

The driver simply has to request that the PCI layer set up the MSI
capability for this device.

To automatically use MSI or MSI-X interrupt vectors, use the following function:

```c
int pci_alloc_irq_vectors(struct pci_dev *dev, unsigned int min_vecs,
              unsigned int max_vecs, unsigned int flags);
```

which allocates up to max_vecs interrupt vectors for a PCI device.
It returns the number of vectors allocated or a negative error. If
the device has a requirements for a minimum number of vectors the
driver can pass a min_vecs argument set to this limit, and the PCI
core will return -ENOSPC if it can’t meet the minimum number of vectors.

To get the Linux IRQ number passed to `request_irq()` and `free_irq()` and
the vectors, use the following function:

```c
int pci_irq_vector(struct pci_dev *dev, unsigned int nr);
```

### Implementation

#### pci_alloc_irq_vectors

```
pci_alloc_irq_vectors
  - pci_alloc_irq_vectors_affinity
    - __pci_enable_msix_range (for msix)
      - msix_capability_init
        - pci_msi_setup_msi_irqs -----------------------------------------+
    - __pci_enable_msi_range (for msi)                                    |
      - msi_capability_init: configure device's MSI capability structure  |
        - msi_setup_entry                                                 |
          - pci_msi_setup_msi_irqs ---------------------------------------+
    - pci_intx (for legacy)                                               |
                                                                          |
pci_msi_setup_msi_irqs <--------------------------------------------------+
  - msi_domain_alloc_irqs
    - msi_domain_prepare_irqs
      - its_msi_prepare
    - __irq_domain_alloc_irqs
```

```c
static inline int
pci_alloc_irq_vectors(struct pci_dev *dev, unsigned int min_vecs,
                      unsigned int max_vecs, unsigned int flags)
{
        return pci_alloc_irq_vectors_affinity(dev, min_vecs, max_vecs, flags,
                                              NULL);
}
```

`pci_alloc_irq_vectors_affinity` dispatches either of **MSI**, **MSIX** or
**LEGACY**.

```c
/**
 * pci_alloc_irq_vectors_affinity - allocate multiple IRQs for a device
 * @dev:                PCI device to operate on
 * @min_vecs:           minimum number of vectors required (must be >= 1)
 * @max_vecs:           maximum (desired) number of vectors
 * @flags:              flags or quirks for the allocation
 * @affd:               optional description of the affinity requirements
 *
 * Allocate up to @max_vecs interrupt vectors for @dev, using MSI-X or MSI
 * vectors if available, and fall back to a single legacy vector
 * if neither is available.  Return the number of vectors allocated,
 * (which might be smaller than @max_vecs) if successful, or a negative
 * error code on error. If less than @min_vecs interrupt vectors are
 * available for @dev the function will fail with -ENOSPC.
 *
 * To get the Linux IRQ number used for a vector that can be passed to
 * request_irq() use the pci_irq_vector() helper.
 */
 int pci_alloc_irq_vectors_affinity(struct pci_dev *dev, unsigned int min_vecs,
                                   unsigned int max_vecs, unsigned int flags,
                                   const struct irq_affinity *affd)
{
        static const struct irq_affinity msi_default_affd;
        int msix_vecs = -ENOSPC;
        int msi_vecs = -ENOSPC;

        if (flags & PCI_IRQ_AFFINITY) {
                if (!affd)
                        affd = &msi_default_affd;
        } else {
                if (WARN_ON(affd))
                        affd = NULL;
        }

        if (flags & PCI_IRQ_MSIX) {
                msix_vecs = __pci_enable_msix_range(dev, NULL, min_vecs,
                                                    max_vecs, affd);
                if (msix_vecs > 0)
                        return msix_vecs;
        }

        if (flags & PCI_IRQ_MSI) {
                msi_vecs = __pci_enable_msi_range(dev, min_vecs, max_vecs,
                                                  affd);
                if (msi_vecs > 0)
                        return msi_vecs;
        }

        /* use legacy irq if allowed */
        if (flags & PCI_IRQ_LEGACY) {
                if (min_vecs == 1 && dev->irq) {
                        pci_intx(dev, 1);
                        return 1;
                }
        }

        if (msix_vecs == -ENOSPC)
                return -ENOSPC;
        return msi_vecs;
}
```

#### Enable MSI-X

```c
static int __pci_enable_msix_range(struct pci_dev *dev,
                                   struct msix_entry *entries, int minvec,
                                   int maxvec, const struct irq_affinity *affd)
{
        int rc, nvec = maxvec;

        if (maxvec < minvec)
                return -ERANGE;

        /*
         * If the caller is passing in sets, we can't support a range of
         * supported vectors. The caller needs to handle that.
         */
        if (affd && affd->nr_sets && minvec != maxvec)
                return -EINVAL;

        if (WARN_ON_ONCE(dev->msix_enabled))
                return -EINVAL;

        for (;;) {
                if (affd) {
                        nvec = irq_calc_affinity_vectors(minvec, nvec, affd);
                        if (nvec < minvec)
                                return -ENOSPC;
                }

                rc = __pci_enable_msix(dev, entries, nvec, affd);
                if (rc == 0)
                        return nvec;

                if (rc < 0)
                        return rc;
                if (rc < minvec)
                        return -ENOSPC;

                nvec = rc;
        }
}
```

Let's skip irq affinity here.

```
__pci_enable_msix
  - pci_msi_supported
  - pci_msix_vec_count
  - msix_capability_init
```

```c
static int __pci_enable_msix(struct pci_dev *dev, struct msix_entry *entries,
                             int nvec, const struct irq_affinity *affd)
{
        int nr_entries;
        int i, j;

        if (!pci_msi_supported(dev, nvec))
                return -EINVAL;

        nr_entries = pci_msix_vec_count(dev);
        if (nr_entries < 0)
                return nr_entries;
        if (nvec > nr_entries)
                return nr_entries;

        if (entries) {
                /* Check for any invalid entries */
                for (i = 0; i < nvec; i++) {
                        if (entries[i].entry >= nr_entries)
                                return -EINVAL;         /* invalid entry */
                        for (j = i + 1; j < nvec; j++) {
                                if (entries[i].entry == entries[j].entry)
                                        return -EINVAL; /* duplicate entry */
                        }
                }
        }

        /* Check whether driver already requested for MSI irq */
        if (dev->msi_enabled) {
                pci_info(dev, "can't enable MSI-X (MSI IRQ already assigned)\n");
                return -EINVAL;
        }
        return msix_capability_init(dev, entries, nvec, affd);
}
```

```c
/**
 * pci_msi_supported - check whether MSI may be enabled on a device
 * @dev: pointer to the pci_dev data structure of MSI device function
 * @nvec: how many MSIs have been requested ?
 *
 * Look at global flags, the device itself, and its parent buses
 * to determine if MSI/-X are supported for the device. If MSI/-X is
 * supported return 1, else return 0.
 **/
static int pci_msi_supported(struct pci_dev *dev, int nvec)
{
        struct pci_bus *bus;

        /* MSI must be globally enabled and supported by the device */
        if (!pci_msi_enable)
                return 0;

        if (!dev || dev->no_msi || dev->current_state != PCI_D0)
                return 0;

        /*
         * You can't ask to have 0 or less MSIs configured.
         *  a) it's stupid ..
         *  b) the list manipulation code assumes nvec >= 1.
         */
        if (nvec < 1)
                return 0;

        /*
         * Any bridge which does NOT route MSI transactions from its
         * secondary bus to its primary bus must set NO_MSI flag on
         * the secondary pci_bus.
         * We expect only arch-specific PCI host bus controller driver
         * or quirks for specific PCI bridges to be setting NO_MSI.
         */
        for (bus = dev->bus; bus; bus = bus->parent)
                if (bus->bus_flags & PCI_BUS_FLAGS_NO_MSI)
                        return 0;

        return 1;
}
```

```c
/**
 * pci_msix_vec_count - return the number of device's MSI-X table entries
 * @dev: pointer to the pci_dev data structure of MSI-X device function
 * This function returns the number of device's MSI-X table entries and
 * therefore the number of MSI-X vectors device is capable of sending.
 * It returns a negative errno if the device is not capable of sending MSI-X
 * interrupts.
 **/
int pci_msix_vec_count(struct pci_dev *dev)
{
        u16 control;

        if (!dev->msix_cap)
                return -EINVAL;

        pci_read_config_word(dev, dev->msix_cap + PCI_MSIX_FLAGS, &control);
        return msix_table_size(control);
}
EXPORT_SYMBOL(pci_msix_vec_count);
```

```
msix_capability_init
  - pci_msix_clear_and_set_ctrl: disable msi-x enable bit
  - msix_map_region: compute the physical addres of msi-x table and map it
                     to virtual address
  - msix_setup_entries: allocate and initialize msi_desc for each vector
  - pci_msi_setup_msi_irqs
  - msi_verify_entries
```

```c
/**
 * msix_capability_init - configure device's MSI-X capability
 * @dev: pointer to the pci_dev data structure of MSI-X device function
 * @entries: pointer to an array of struct msix_entry entries
 * @nvec: number of @entries
 * @affd: Optional pointer to enable automatic affinity assignement
 *
 * Setup the MSI-X capability structure of device function with a
 * single MSI-X irq. A return of zero indicates the successful setup of
 * requested MSI-X entries with allocated irqs or non-zero for otherwise.
 **/
static int msix_capability_init(struct pci_dev *dev, struct msix_entry *entries,
                                int nvec, const struct irq_affinity *affd)
{
        int ret;
        u16 control;
        void __iomem *base;

        /* Ensure MSI-X is disabled while it is set up */
        pci_msix_clear_and_set_ctrl(dev, PCI_MSIX_FLAGS_ENABLE, 0);

        pci_read_config_word(dev, dev->msix_cap + PCI_MSIX_FLAGS, &control);
        /* Request & Map MSI-X table region */
	/* base is the virtual address of msi-x table */
        base = msix_map_region(dev, msix_table_size(control));
        if (!base)
                return -ENOMEM;

        ret = msix_setup_entries(dev, base, entries, nvec, affd);
        if (ret)
                return ret;

        ret = pci_msi_setup_msi_irqs(dev, nvec, PCI_CAP_ID_MSIX);
        if (ret)
                goto out_avail;

        /* Check if all MSI entries honor device restrictions */
        ret = msi_verify_entries(dev);
        if (ret)
                goto out_free;

        /*
         * Some devices require MSI-X to be enabled before we can touch the
         * MSI-X registers.  We need to mask all the vectors to prevent
         * interrupts coming in before they're fully set up.
         */
        pci_msix_clear_and_set_ctrl(dev, 0,
                                PCI_MSIX_FLAGS_MASKALL | PCI_MSIX_FLAGS_ENABLE);

        msix_program_entries(dev, entries);

        ret = populate_msi_sysfs(dev);
        if (ret)
                goto out_free;

        /* Set MSI-X enabled bits and unmask the function */
        pci_intx_for_msi(dev, 0);
        dev->msix_enabled = 1;
        pci_msix_clear_and_set_ctrl(dev, PCI_MSIX_FLAGS_MASKALL, 0);

        pcibios_free_irq(dev);
        return 0;

out_avail:
        if (ret < 0) {
                /*
                 * If we had some success, report the number of irqs
                 * we succeeded in setting up.
                 */
                struct msi_desc *entry;
                int avail = 0;

                for_each_pci_msi_entry(entry, dev) {
                        if (entry->irq != 0)
                                avail++;
                }
                if (avail != 0)
                        ret = avail;
        }

out_free:
        free_msi_irqs(dev);

        return ret;
}

static int msix_setup_entries(struct pci_dev *dev, void __iomem *base,
                              struct msix_entry *entries, int nvec,
                              const struct irq_affinity *affd)
{
        struct irq_affinity_desc *curmsk, *masks = NULL;
        struct msi_desc *entry;
        int ret, i;

        if (affd)
                masks = irq_create_affinity_masks(nvec, affd);

        for (i = 0, curmsk = masks; i < nvec; i++) {
                entry = alloc_msi_entry(&dev->dev, 1, curmsk);
                if (!entry) {
                        if (!i)
                                iounmap(base);
                        else
                                free_msi_irqs(dev);
                        /* No enough memory. Don't try again */
                        ret = -ENOMEM;
                        goto out;
                }

                entry->msi_attrib.is_msix       = 1;
                entry->msi_attrib.is_64         = 1;
                if (entries)
                        entry->msi_attrib.entry_nr = entries[i].entry;
                else
                        entry->msi_attrib.entry_nr = i;
                entry->msi_attrib.default_irq   = dev->irq;
                entry->mask_base                = base;

                list_add_tail(&entry->list, dev_to_msi_list(&dev->dev));
                if (masks)
                        curmsk++;
        }
        ret = 0;
out:
        kfree(masks);
        return ret;
}
```


```c
static int pci_msi_setup_msi_irqs(struct pci_dev *dev, int nvec, int type)
{
        struct irq_domain *domain;

        domain = dev_get_msi_domain(&dev->dev);
        if (domain && irq_domain_is_hierarchy(domain))
                return msi_domain_alloc_irqs(domain, &dev->dev, nvec);

        return arch_setup_msi_irqs(dev, nvec, type);
}
```

the function invokes `msi_domain_alloc_irqs` which allocates Linux irqs
from a MSI interrupt domain.

```c
int msi_domain_alloc_irqs(struct irq_domain *domain, struct device *dev,
                          int nvec)
{
        struct msi_domain_info *info = domain->host_data;
        struct msi_domain_ops *ops = info->ops;
        struct irq_data *irq_data;
        struct msi_desc *desc;
        msi_alloc_info_t arg;
        int i, ret, virq;
        bool can_reserve;

        // creates device and inserts into ITS device list
        ret = msi_domain_prepare_irqs(domain, dev, nvec, &arg);
        if (ret)
                return ret;

        for_each_msi_entry(desc, dev) {
                ops->set_desc(&arg, desc);

                // allocates linux irq
                virq = __irq_domain_alloc_irqs(domain, -1, desc->nvec_used,
                                               dev_to_node(dev), &arg, false,
                                               desc->affinity);
                if (virq < 0) {
                        ret = -ENOSPC;
                        if (ops->handle_error)
                                ret = ops->handle_error(domain, desc, ret);
                        if (ops->msi_finish)
                                ops->msi_finish(&arg, ret);
                        return ret;
                }

                for (i = 0; i < desc->nvec_used; i++) {
			// set MSI descriptor data for an irq offset
                        irq_set_msi_desc_off(virq, i, desc);
                        irq_debugfs_copy_devname(virq + i, dev);
                }
        }

        if (ops->msi_finish)
                ops->msi_finish(&arg, 0);

        can_reserve = msi_check_reservation_mode(domain, info, dev);

        for_each_msi_entry(desc, dev) {
                virq = desc->irq;
                if (desc->nvec_used == 1)
                        dev_dbg(dev, "irq %d for MSI\n", virq);
                else
                        dev_dbg(dev, "irq [%d-%d] for MSI\n",
                                virq, virq + desc->nvec_used - 1);
                /*
                 * This flag is set by the PCI layer as we need to activate
                 * the MSI entries before the PCI layer enables MSI in the
                 * card. Otherwise the card latches a random msi message.
                 */
                if (!(info->flags & MSI_FLAG_ACTIVATE_EARLY))
                        continue;

                irq_data = irq_domain_get_irq_data(domain, desc->irq);
                if (!can_reserve)
                        irqd_clr_can_reserve(irq_data);
                ret = irq_domain_activate_irq(irq_data, can_reserve);
                if (ret)
                        goto cleanup;
        }

        /*
         * If these interrupts use reservation mode, clear the activated bit
         * so request_irq() will assign the final vector.
         */
        if (can_reserve) {
                for_each_msi_entry(desc, dev) {
                        irq_data = irq_domain_get_irq_data(domain, desc->irq);
                        irqd_clr_activated(irq_data);
                }
        }
        return 0;

cleanup:
        for_each_msi_entry(desc, dev) {
                struct irq_data *irqd;

                if (desc->irq == virq)
                        break;

                irqd = irq_domain_get_irq_data(domain, desc->irq);
                if (irqd_is_activated(irqd))
                        irq_domain_deactivate_irq(irqd);
        }
        msi_domain_free_irqs(domain, dev);
        return ret;
}
```

#### pci_irq_vector

```c
/**
 * pci_irq_vector - return Linux IRQ number of a device vector
 * @dev: PCI device to operate on
 * @nr: device-relative interrupt vector index (0-based).
 */
int pci_irq_vector(struct pci_dev *dev, unsigned int nr)
{
        if (dev->msix_enabled) {
                struct msi_desc *entry;
                int i = 0;

                for_each_pci_msi_entry(entry, dev) {
                        if (i == nr)
                                return entry->irq;
                        i++;
                }
                WARN_ON_ONCE(1);
                return -EINVAL;
        }

        if (dev->msi_enabled) {
                struct msi_desc *entry = first_pci_msi_entry(dev);

                if (WARN_ON_ONCE(nr >= entry->nvec_used))
                        return -EINVAL;
        } else {
                if (WARN_ON_ONCE(nr > 0))
                        return -EINVAL;
        }

        return dev->irq + nr;
}
EXPORT_SYMBOL(pci_irq_vector);
```


## Reference

> Documentation/PCI/pci.txt
> Documentation/PCI/MSI-HOWTO.txt
> https://docs.oracle.com/cd/E19683-01/806-5222/6je8fjvhe/index.html#hwovr-fig-23