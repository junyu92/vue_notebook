# Interrupt Translation Service

## Introduction

An *Interrupt Translation Service* maps interrupts to INTIDs and
redistributors.

New class of interrupts (LPI) via an Interrupt Translation Service (ITS)
* Allows MSI/MSI-X support
* Supports indirections for target cores (via collections)
* Introduces device ID sampled from the bus
* New IRQ class with possibly thousands of LPIs and probably sparse
  allocation Tables are held in physical memory

## Model

```
   +--------+                  +-------------+     +------------+
   | Device | ---------------> | Interrupt   |     | Collection |
   | Table  |                  | Translation |     | Table      |
   +--------+ <-----------     | Tables      |     +------------+
                          \    +-------------+      ^
                           \         ^              |
                            \        |             /
+------------------+         V       V            V
| Peripheral sends |         +--------------------+     +---------------+
| interrupt as     | ------> | ITS                | --> | Redistributor |
| message to ITS   |         +--------------------+     +---------------+
+------------------+
```

1. Peripheral sends interrupt as a message to the ITS
   - The message specifies the DeviceID (which peripheral) and
     an EventID (which interrupt from that peripheral)
2. ITS uses the DeviceID to index into the Device Table
   - Returns pointer to a peripheral specific Interrupt Translation Table
3. ITS uses the EventID to index into the Interrupt Translation Table
   - Returns the INTID and Collection ID
4. ITS uses the Collection ID to index into the Collection Table
   - Returns the target Redistributor
5. ITS forwards interrupt to Redistributor

## Term

* **ITT**: tranlation table
* **ITT_entry_size**: the number of bytes per tranlation table entry
* **Pending Table** (*Linux*):
  The address of Pending Table is stored in register `GICR_PENDBASER`.
* **LPI Configuration table** (`prop_table` in Linux):
  The address of LPI Configuration table is stored in
  register `GICR_PROPBASER` which specifies the base address of the LPI
  Configuration table, and the Shareability and Cacheability of
  accesses to the LPI Configuration table.

## Message Signalled Interrupts (MSI)

### MSI types

* MSI
* MSI-X

## Device Tree Node

*GICv3* has one or more ITS that are used to route Message Signalled
Interrupts (MSI) to the CPUS.

For example,

```
	gic: interrupt-controller@2cf00000 {
		compatible = "arm,gic-v3";
		#interrupt-cells = <3>;
		#address-cells = <2>;
		#size-cells = <2>;
		ranges;
		interrupt-controller;
		reg = <0x0 0x2f000000 0 0x10000>,	// GICD
		      <0x0 0x2f100000 0 0x200000>,	// GICR
		      <0x0 0x2c000000 0 0x2000>,	// GICC
		      <0x0 0x2c010000 0 0x2000>,	// GICH
		      <0x0 0x2c020000 0 0x2000>;	// GICV
		interrupts = <1 9 4>;

		gic-its@2c200000 {
			compatible = "arm,gic-v3-its";
			msi-controller;
			reg = <0x0 0x2c200000 0 0x200000>;
		};
	};

	gic: interrupt-controller@2c010000 {
		compatible = "arm,gic-v3";
		#interrupt-cells = <3>;
		#address-cells = <2>;
		#size-cells = <2>;
		ranges;
		interrupt-controller;
		redistributor-stride = <0x0 0x40000>;	// 256kB stride
		#redistributor-regions = <2>;
		reg = <0x0 0x2c010000 0 0x10000>,	// GICD
		      <0x0 0x2d000000 0 0x800000>,	// GICR 1: CPUs 0-31
		      <0x0 0x2e000000 0 0x800000>;	// GICR 2: CPUs 32-63
		      <0x0 0x2c040000 0 0x2000>,	// GICC
		      <0x0 0x2c060000 0 0x2000>,	// GICH
		      <0x0 0x2c080000 0 0x2000>;	// GICV
		interrupts = <1 9 4>;

		gic-its@2c200000 {
			compatible = "arm,gic-v3-its";
			msi-controller;
			reg = <0x0 0x2c200000 0 0x200000>;
		};

		gic-its@2c400000 {
			compatible = "arm,gic-v3-its";
			msi-controller;
			reg = <0x0 0x2c400000 0 0x200000>;
		};
	};
```

## HOW TO

### Data Structures

```c
static LIST_HEAD(lpi_range_list);
```

contains ranges of LPIs that are to available to allocate from.

```c
/*
 * The ITS view of a device - belongs to an ITS, owns an interrupt
 * translation table, and a list of interrupts.  If it some of its
 * LPIs are injected into a guest (GICv4), the event_map.vm field
 * indicates which one.
 */
struct its_device {
        struct list_head        entry;
        struct its_node         *its;
        struct event_lpi_map    event_map;
        void                    *itt;
        u32                     nr_ites;
        u32                     device_id;
        bool                    shared;
};
```

```c
struct event_lpi_map {
        unsigned long           *lpi_map;
        / collection mapping: maps event id to cpu */
        u16                     *col_map;
        irq_hw_number_t         lpi_base;
        int                     nr_lpis;
        struct mutex            vlpi_lock;
        struct its_vm           *vm;
        struct its_vlpi_map     *vlpi_maps;
        int                     nr_vlpis;
};
```

### Helper function for its chip

#### create device

`its_msi_prepare` is invokes when msi/msix is enabling.

```
- msi_capability_init
- msix_capability_init
  - pci_msi_setup_msi_irqs
    - msi_domain_alloc_irqs
      - msi_domain_prepare_irqs
```

```c
static int its_msi_prepare(struct irq_domain *domain, struct device *dev,
                           int nvec, msi_alloc_info_t *info)
{
        struct its_node *its;
        struct its_device *its_dev;
        struct msi_domain_info *msi_info;
        u32 dev_id;
        int err = 0;

        /*
         * We ignore "dev" entierely, and rely on the dev_id that has
         * been passed via the scratchpad. This limits this domain's
         * usefulness to upper layers that definitely know that they
         * are built on top of the ITS.
         */
        dev_id = info->scratchpad[0].ul;

        msi_info = msi_get_domain_info(domain);
        its = msi_info->data;

        if (!gic_rdists->has_direct_lpi &&
            vpe_proxy.dev &&
            vpe_proxy.dev->its == its &&
            dev_id == vpe_proxy.dev->device_id) {
                /* Bad luck. Get yourself a better implementation */
                WARN_ONCE(1, "DevId %x clashes with GICv4 VPE proxy device\n",
                          dev_id);
                return -EINVAL;
        }

        mutex_lock(&its->dev_alloc_lock);
        its_dev = its_find_device(its, dev_id);
        if (its_dev) {
                /*
                 * We already have seen this ID, probably through
                 * another alias (PCI bridge of some sort). No need to
                 * create the device.
                 */
                its_dev->shared = true;
                pr_debug("Reusing ITT for devID %x\n", dev_id);
                goto out;
        }

        its_dev = its_create_device(its, dev_id, nvec, true);
        if (!its_dev) {
                err = -ENOMEM;
                goto out;
        }

        pr_debug("ITT %d entries, %d bits\n", nvec, ilog2(nvec));
out:
        mutex_unlock(&its->dev_alloc_lock);
        info->scratchpad[0].ptr = its_dev;
        return err;
}

static struct its_device *its_create_device(struct its_node *its, u32 dev_id,
                                            int nvecs, bool alloc_lpis)
{
        struct its_device *dev;
        unsigned long *lpi_map = NULL;
        unsigned long flags;
        u16 *col_map = NULL;
        void *itt;
        int lpi_base;
        int nr_lpis;
        int nr_ites;
        int sz;

        if (!its_alloc_device_table(its, dev_id))
                return NULL;

        if (WARN_ON(!is_power_of_2(nvecs)))
                nvecs = roundup_pow_of_two(nvecs);

        dev = kzalloc(sizeof(*dev), GFP_KERNEL);
        /*
         * Even if the device wants a single LPI, the ITT must be
         * sized as a power of two (and you need at least one bit...).
         */
        nr_ites = max(2, nvecs);
        sz = nr_ites * its->ite_size;
        sz = max(sz, ITS_ITT_ALIGN) + ITS_ITT_ALIGN - 1;
        itt = kzalloc(sz, GFP_KERNEL);
        if (alloc_lpis) {
                lpi_map = its_lpi_alloc(nvecs, &lpi_base, &nr_lpis);
                if (lpi_map)
                        col_map = kcalloc(nr_lpis, sizeof(*col_map),
                                          GFP_KERNEL);
        } else {
                col_map = kcalloc(nr_ites, sizeof(*col_map), GFP_KERNEL);
                nr_lpis = 0;
                lpi_base = 0;
        }

        if (!dev || !itt ||  !col_map || (!lpi_map && alloc_lpis)) {
                kfree(dev);
                kfree(itt);
                kfree(lpi_map);
                kfree(col_map);
                return NULL;
        }

        gic_flush_dcache_to_poc(itt, sz);

        dev->its = its;
        dev->itt = itt;
        dev->nr_ites = nr_ites;
        dev->event_map.lpi_map = lpi_map;
        dev->event_map.col_map = col_map;
        dev->event_map.lpi_base = lpi_base;
        dev->event_map.nr_lpis = nr_lpis;
        mutex_init(&dev->event_map.vlpi_lock);
        dev->device_id = dev_id;
        INIT_LIST_HEAD(&dev->entry);

        raw_spin_lock_irqsave(&its->lock, flags);
        list_add(&dev->entry, &its->its_device_list);
        raw_spin_unlock_irqrestore(&its->lock, flags);

        /* Map device to its ITT */
        its_send_mapd(dev, 1);

        return dev;
}
```

#### allocate hwirq for device

```c
static int its_irq_domain_alloc(struct irq_domain *domain, unsigned int virq,
                                unsigned int nr_irqs, void *args)
{
        msi_alloc_info_t *info = args;
        struct its_device *its_dev = info->scratchpad[0].ptr;
        irq_hw_number_t hwirq;
        int err;
        int i;

        // alloc hardware irq
        err = its_alloc_device_irq(its_dev, nr_irqs, &hwirq);
        if (err)
                return err;

        for (i = 0; i < nr_irqs; i++) {
                err = its_irq_gic_domain_alloc(domain, virq + i, hwirq + i);
                if (err)
                        return err;

                // setup irq_data
                irq_domain_set_hwirq_and_chip(domain, virq + i,
                                              hwirq + i, &its_irq_chip, its_dev);
                irqd_set_single_target(irq_desc_get_irq_data(irq_to_desc(virq + i)));
                pr_debug("ID:%d pID:%d vID:%d\n",
                         (int)(hwirq + i - its_dev->event_map.lpi_base),
                         (int)(hwirq + i), virq + i);
        }

        return 0;
}
```

#### activate irq

```c
static int its_irq_domain_activate(struct irq_domain *domain,
                                   struct irq_data *d, bool reserve)
{
        struct its_device *its_dev = irq_data_get_irq_chip_data(d);
        u32 event = its_get_event_id(d);
        const struct cpumask *cpu_mask = cpu_online_mask;
        int cpu;

        /* get the cpu_mask of local node */
        if (its_dev->its->numa_node >= 0)
                cpu_mask = cpumask_of_node(its_dev->its->numa_node);

        /* Bind the LPI to the first possible CPU */
        cpu = cpumask_first_and(cpu_mask, cpu_online_mask);
        if (cpu >= nr_cpu_ids) {
                if (its_dev->its->flags & ITS_FLAGS_WORKAROUND_CAVIUM_23144)
                        return -EINVAL;

                cpu = cpumask_first(cpu_online_mask);
        }

        its_dev->event_map.col_map[event] = cpu;
        irq_data_update_effective_affinity(d, cpumask_of(cpu));

        /* Map the GIC IRQ and event to the device */
        its_send_mapti(its_dev, d->hwirq, event);
        return 0;
}
```

### Create GIC ITS chip

When kernel is initializing GICv3 chip, it will probe ITS chip and try to
initialize it.

```c
static int __init gic_init_bases(void __iomem *dist_base,
                                 struct redist_region *rdist_regs,
                                 u32 nr_redist_regions,
                                 u64 redist_stride,
                                 struct fwnode_handle *handle)
{
	// ...

        if (gic_dist_supports_lpis()) {
                its_init(handle, &gic_data.rdists, gic_data.domain);
                its_cpu_init();
        }

	// ...
}
```

For example.

```
[    0.000000] NR_IRQS: 64, nr_irqs: 64, preallocated irqs: 0
[    0.000000] GICv3: 256 SPIs implemented
[    0.000000] GICv3: 0 Extended SPIs implemented
[    0.000000] GICv3: Distributor has no Range Selector support
[    0.000000] GICv3: 16 PPIs implemented
[    0.000000] GICv3: no VLPI support, no direct LPI support
[    0.000000] GICv3: CPU0: found redistributor 0 region 0:0x00000000080a0000
[    0.000000] ACPI: SRAT not present
[    0.000000] ITS [mem 0x08080000-0x0809ffff]
[    0.000000] ITS@0x0000000008080000: allocated 8192 Devices @12a7b0000 (indireect, esz 8, psz 64K, shr 1)
[    0.000000] ITS@0x0000000008080000: allocated 8192 Interrupt Collections @12aa7c0000 (flat, esz 8, psz 64K, shr 1)
[    0.000000] GICv3: using LPI property table @0x000000012a7d0000
[    0.000000] GICv3: CPU0: using allocated LPI pending table @0x000000012a7e00000
```

`gic_init_bases` invokes `its_init` method.

```c
int __init its_init(struct fwnode_handle *handle, struct rdists *rdists,
                    struct irq_domain *parent_domain)
{
        struct device_node *of_node;
        struct its_node *its;
        bool has_v4 = false;
        int err;

        its_parent = parent_domain;
        of_node = to_of_node(handle);
        if (of_node)
                its_of_probe(of_node);
        else
                its_acpi_probe();

        if (list_empty(&its_nodes)) {
                pr_warn("ITS: No ITS available, not enabling LPIs\n");
                return -ENXIO;
        }

        gic_rdists = rdists;

        err = allocate_lpi_tables();
        if (err)
                return err;

        list_for_each_entry(its, &its_nodes, entry)
                has_v4 |= its->is_v4;

        if (has_v4 & rdists->has_vlpis) {
                if (its_init_vpe_domain() ||
                    its_init_v4(parent_domain, &its_vpe_domain_ops)) {
                        rdists->has_vlpis = false;
                        pr_err("ITS: Disabling GICv4 support\n");
                }
        }

        register_syscore_ops(&its_syscore_ops);

        return 0;
}
```

`its_init` is trivial.

```
its_init
  - its_of_probe
  - allocate_lpi_tables
```

#### probe its chip

```c
static int __init its_probe_one(struct resource *res,
                                struct fwnode_handle *handle, int numa_node)
{
        struct its_node *its;
        void __iomem *its_base;
        u32 val, ctlr;
        u64 baser, tmp, typer;
        int err;

        its_base = ioremap(res->start, resource_size(res));
        if (!its_base) {
                pr_warn("ITS@%pa: Unable to map ITS registers\n", &res->start);
                return -ENOMEM;
        }

        val = readl_relaxed(its_base + GITS_PIDR2) & GIC_PIDR2_ARCH_MASK;
        if (val != 0x30 && val != 0x40) {
                pr_warn("ITS@%pa: No ITS detected, giving up\n", &res->start);
                err = -ENODEV;
                goto out_unmap;
        }

        err = its_force_quiescent(its_base);
        if (err) {
                pr_warn("ITS@%pa: Failed to quiesce, giving up\n", &res->start);
                goto out_unmap;
        }

        pr_info("ITS %pR\n", res);

        its = kzalloc(sizeof(*its), GFP_KERNEL);
        if (!its) {
                err = -ENOMEM;
                goto out_unmap;
        }
```

```c
        raw_spin_lock_init(&its->lock);
        mutex_init(&its->dev_alloc_lock);
        INIT_LIST_HEAD(&its->entry);
        INIT_LIST_HEAD(&its->its_device_list);
```

```c
        // Read `GITS_TYPER` to get the features of the ITS.
        typer = gic_read_typer(its_base + GITS_TYPER);
        // virtual address
        its->base = its_base;
        // physical address specified by dts
        its->phys_base = res->start;
        // get ITT_entry_size, bits [7:4]
        its->ite_size = GITS_TYPER_ITT_ENTRY_SIZE(typer);
        // The number of DeviceID
        its->device_ids = GITS_TYPER_DEVBITS(typer);
        its->is_v4 = !!(typer & GITS_TYPER_VLPIS);
        if (its->is_v4) {
                if (!(typer & GITS_TYPER_VMOVP)) {
                        err = its_compute_its_list_map(res, its_base);
                        if (err < 0)
                                goto out_free_its;

                        its->list_nr = err;

                        pr_info("ITS@%pa: Using ITS number %d\n",
                                &res->start, err);
                } else {
                        pr_info("ITS@%pa: Single VMOVP capable\n", &res->start);
                }
        }

        its->numa_node = numa_node;

        its->cmd_base = (void *)__get_free_pages(GFP_KERNEL | __GFP_ZERO,
                                                get_order(ITS_CMD_QUEUE_SZ));
        if (!its->cmd_base) {
                err = -ENOMEM;
                goto out_free_its;
        }
        its->cmd_write = its->cmd_base;
        its->fwnode_handle = handle;
	/*
         * the purpose of GITS_TRANSLATER register is to be
         * Written by a requesting Device to signal an interrupt
         * for translation by the ITS.
	 */
        its->get_msi_base = its_irq_get_msi_base;
        its->msi_domain_flags = IRQ_DOMAIN_FLAG_MSI_REMAP;

        its_enable_quirks(its);

        err = its_alloc_tables(its);
        if (err)
                goto out_free_cmd;

        err = its_alloc_collections(its);
        if (err)
                goto out_free_tables;

        baser = (virt_to_phys(its->cmd_base)    |
                 GITS_CBASER_RaWaWb             |
                 GITS_CBASER_InnerShareable     |
                 (ITS_CMD_QUEUE_SZ / SZ_4K - 1) |
                 GITS_CBASER_VALID);

        gits_write_cbaser(baser, its->base + GITS_CBASER);
        tmp = gits_read_cbaser(its->base + GITS_CBASER);

        if ((tmp ^ baser) & GITS_CBASER_SHAREABILITY_MASK) {
                if (!(tmp & GITS_CBASER_SHAREABILITY_MASK)) {
                        /*
                         * The HW reports non-shareable, we must
                         * remove the cacheability attributes as
                         * well.
                         */
                        baser &= ~(GITS_CBASER_SHAREABILITY_MASK |
                                   GITS_CBASER_CACHEABILITY_MASK);
                        baser |= GITS_CBASER_nC;
                        gits_write_cbaser(baser, its->base + GITS_CBASER);
                }
                pr_info("ITS: using cache flushing for cmd queue\n");
                its->flags |= ITS_FLAGS_CMDQ_NEEDS_FLUSHING;
        }

        gits_write_cwriter(0, its->base + GITS_CWRITER);
        ctlr = readl_relaxed(its->base + GITS_CTLR);
        ctlr |= GITS_CTLR_ENABLE;
        if (its->is_v4)
                ctlr |= GITS_CTLR_ImDe;
        writel_relaxed(ctlr, its->base + GITS_CTLR);

        if (GITS_TYPER_HCC(typer))
                its->flags |= ITS_FLAGS_SAVE_SUSPEND_STATE;

        err = its_init_domain(handle, its);
        if (err)
                goto out_free_tables;

        raw_spin_lock(&its_lock);
        list_add(&its->entry, &its_nodes);
        raw_spin_unlock(&its_lock);

        return 0;

out_free_tables:
        its_free_tables(its);
out_free_cmd:
        free_pages((unsigned long)its->cmd_base, get_order(ITS_CMD_QUEUE_SZ));
out_free_its:
        kfree(its);
out_unmap:
        iounmap(its_base);
        pr_err("ITS@%pa: failed probing (%d)\n", &res->start, err);
        return err;
}
```

initialize tables

```c
static int its_alloc_tables(struct its_node *its)
{
        u64 shr = GITS_BASER_InnerShareable;
        u64 cache = GITS_BASER_RaWaWb;
        u32 psz = SZ_64K;
        int err, i;

        if (its->flags & ITS_FLAGS_WORKAROUND_CAVIUM_22375)
                /* erratum 24313: ignore memory access type */
                cache = GITS_BASER_nCnB;

        for (i = 0; i < GITS_BASER_NR_REGS; i++) {
                struct its_baser *baser = its->tables + i;
                u64 val = its_read_baser(its, baser);
                u64 type = GITS_BASER_TYPE(val);
                u32 order = get_order(psz);
                bool indirect = false;

                switch (type) {
                case GITS_BASER_TYPE_NONE:
                        continue;

                case GITS_BASER_TYPE_DEVICE:
                        indirect = its_parse_indirect_baser(its, baser,
                                                            psz, &order,
                                                            its->device_ids);
                case GITS_BASER_TYPE_VCPU:
                        indirect = its_parse_indirect_baser(its, baser,
                                                            psz, &order,
                                                            ITS_MAX_VPEID_BITS);
                        break;
                }

                err = its_setup_baser(its, baser, cache, shr, psz, order, indirect);
                if (err < 0) {
                        its_free_tables(its);
                        return err;
                }

                /* Update settings which will be used for next BASERn */
                psz = baser->psz;
                cache = baser->val & GITS_BASER_CACHEABILITY_MASK;
                shr = baser->val & GITS_BASER_SHAREABILITY_MASK;
        }

        return 0;
}
```

initialize collections

```c
static int its_alloc_collections(struct its_node *its)
{
        int i;

        its->collections = kcalloc(nr_cpu_ids, sizeof(*its->collections),
                                   GFP_KERNEL);
        if (!its->collections)
                return -ENOMEM;

        for (i = 0; i < nr_cpu_ids; i++)
                its->collections[i].target_address = ~0ULL;

        return 0;
}
```

#### allocate lpi tables

1. its_setup_lpi_prop_table: allocate `prop_table` for `gic_rdists`
2. allocate pending table for each cpu

```c
static int __init allocate_lpi_tables(void)
{
        u64 val;
        int err, cpu;

        /*
         * If LPIs are enabled while we run this from the boot CPU,
         * flag the RD tables as pre-allocated if the stars do align.
         */
        val = readl_relaxed(gic_data_rdist_rd_base() + GICR_CTLR);
        if ((val & GICR_CTLR_ENABLE_LPIS) && enabled_lpis_allowed()) {
                gic_rdists->flags |= (RDIST_FLAGS_RD_TABLES_PREALLOCATED |
                                      RDIST_FLAGS_PROPBASE_NEEDS_FLUSHING);
                pr_info("GICv3: Using preallocated redistributor tables\n");
        }

        err = its_setup_lpi_prop_table();
        if (err)
                return err;

        /*
         * We allocate all the pending tables anyway, as we may have a
         * mix of RDs that have had LPIs enabled, and some that
         * don't. We'll free the unused ones as each CPU comes online.
         */
        for_each_possible_cpu(cpu) {
                struct page *pend_page;

                pend_page = its_allocate_pending_table(GFP_NOWAIT);
                if (!pend_page) {
                        pr_err("Failed to allocate PENDBASE for CPU%d\n", cpu);
                        return -ENOMEM;
                }

                gic_data_rdist_cpu(cpu)->pend_page = pend_page;
        }

        return 0;
}

```c
static int __init its_setup_lpi_prop_table(void)
{
	// if the physical address is reserved, we don't need alloc pages for it.
        if (gic_rdists->flags & RDIST_FLAGS_RD_TABLES_PREALLOCATED) {
                u64 val;

                val = gicr_read_propbaser(gic_data_rdist_rd_base() + GICR_PROPBASER);
                lpi_id_bits = (val & GICR_PROPBASER_IDBITS_MASK) + 1;

                gic_rdists->prop_table_pa = val & GENMASK_ULL(51, 12);
                gic_rdists->prop_table_va = memremap(gic_rdists->prop_table_pa,
                                                     LPI_PROPBASE_SZ,
                                                     MEMREMAP_WB);
                gic_reset_prop_table(gic_rdists->prop_table_va);
        } else {
                struct page *page;

                lpi_id_bits = min_t(u32,
                                    GICD_TYPER_ID_BITS(gic_rdists->gicd_typer),
                                    ITS_MAX_LPI_NRBITS);
                page = its_allocate_prop_table(GFP_NOWAIT);
                if (!page) {
                        pr_err("Failed to allocate PROPBASE\n");
                        return -ENOMEM;
                }

                gic_rdists->prop_table_pa = page_to_phys(page);
                gic_rdists->prop_table_va = page_address(page);
                WARN_ON(gic_reserve_range(gic_rdists->prop_table_pa,
                                          LPI_PROPBASE_SZ));
        }

        pr_info("GICv3: using LPI property table @%pa\n",
                &gic_rdists->prop_table_pa);

        return its_lpi_init(lpi_id_bits);
}
```

initliaze LPI irq numbers

`its_lpi_init` insert LPI numbers [8192-8192+lpis] into `lpi_range_list`.

```c
static int __init its_lpi_init(u32 id_bits)
{
        u32 lpis = (1UL << id_bits) - 8192;
        u32 numlpis;
        int err;

        numlpis = 1UL << GICD_TYPER_NUM_LPIS(gic_rdists->gicd_typer);

        if (numlpis > 2 && !WARN_ON(numlpis > lpis)) {
                lpis = numlpis;
                pr_info("ITS: Using hypervisor restricted LPI range [%u]\n",
                        lpis);
        }

        /*
         * Initializing the allocator is just the same as freeing the
         * full range of LPIs.
         */
        err = free_lpi_range(8192, lpis);
        pr_debug("ITS: Allocator initialized for %u LPIs\n", lpis);
        return err;
}
```

#### its_cpu_init

```c
int its_cpu_init(void)
{
        if (!list_empty(&its_nodes)) {
                int ret;

                ret = redist_disable_lpis();
                if (ret)
                        return ret;

                its_cpu_init_lpis();
                its_cpu_init_collections();
        }

        return 0;
}
```

```c
static void its_cpu_init_lpis(void)
{
        void __iomem *rbase = gic_data_rdist_rd_base();
        struct page *pend_page;
        phys_addr_t paddr;
        u64 val, tmp;

        if (gic_data_rdist()->lpi_enabled)
                return;

        val = readl_relaxed(rbase + GICR_CTLR);
        if ((gic_rdists->flags & RDIST_FLAGS_RD_TABLES_PREALLOCATED) &&
            (val & GICR_CTLR_ENABLE_LPIS)) {
                /*
                 * Check that we get the same property table on all
                 * RDs. If we don't, this is hopeless.
                 */
                paddr = gicr_read_propbaser(rbase + GICR_PROPBASER);
                paddr &= GENMASK_ULL(51, 12);
                if (WARN_ON(gic_rdists->prop_table_pa != paddr))
                        add_taint(TAINT_CRAP, LOCKDEP_STILL_OK);

                paddr = gicr_read_pendbaser(rbase + GICR_PENDBASER);
                paddr &= GENMASK_ULL(51, 16);

                WARN_ON(!gic_check_reserved_range(paddr, LPI_PENDBASE_SZ));
                its_free_pending_table(gic_data_rdist()->pend_page);
                gic_data_rdist()->pend_page = NULL;

                goto out;
        }

        pend_page = gic_data_rdist()->pend_page;
        paddr = page_to_phys(pend_page);
        WARN_ON(gic_reserve_range(paddr, LPI_PENDBASE_SZ));

        /* set PROPBASE */
        val = (gic_rdists->prop_table_pa |
               GICR_PROPBASER_InnerShareable |
               GICR_PROPBASER_RaWaWb |
               ((LPI_NRBITS - 1) & GICR_PROPBASER_IDBITS_MASK));

        gicr_write_propbaser(val, rbase + GICR_PROPBASER);
        tmp = gicr_read_propbaser(rbase + GICR_PROPBASER);

        if ((tmp ^ val) & GICR_PROPBASER_SHAREABILITY_MASK) {
                if (!(tmp & GICR_PROPBASER_SHAREABILITY_MASK)) {
                        /*
                         * The HW reports non-shareable, we must
                         * remove the cacheability attributes as
                         * well.
                         */
                        val &= ~(GICR_PROPBASER_SHAREABILITY_MASK |
                                 GICR_PROPBASER_CACHEABILITY_MASK);
                        val |= GICR_PROPBASER_nC;
                        gicr_write_propbaser(val, rbase + GICR_PROPBASER);
                }
                pr_info_once("GIC: using cache flushing for LPI property table\n");
                gic_rdists->flags |= RDIST_FLAGS_PROPBASE_NEEDS_FLUSHING;
        }

        /* set PENDBASE */
        val = (page_to_phys(pend_page) |
               GICR_PENDBASER_InnerShareable |
               GICR_PENDBASER_RaWaWb);

        gicr_write_pendbaser(val, rbase + GICR_PENDBASER);
        tmp = gicr_read_pendbaser(rbase + GICR_PENDBASER);

        if (!(tmp & GICR_PENDBASER_SHAREABILITY_MASK)) {
                /*
                 * The HW reports non-shareable, we must remove the
                 * cacheability attributes as well.
                 */
                val &= ~(GICR_PENDBASER_SHAREABILITY_MASK |
                         GICR_PENDBASER_CACHEABILITY_MASK);
                val |= GICR_PENDBASER_nC;
                gicr_write_pendbaser(val, rbase + GICR_PENDBASER);
        }

        /* Enable LPIs */
        val = readl_relaxed(rbase + GICR_CTLR);
        val |= GICR_CTLR_ENABLE_LPIS;
        writel_relaxed(val, rbase + GICR_CTLR);

        if (gic_rdists->has_vlpis) {
                void __iomem *vlpi_base = gic_data_rdist_vlpi_base();

                /*
                 * It's possible for CPU to receive VLPIs before it is
                 * sheduled as a vPE, especially for the first CPU, and the
                 * VLPI with INTID larger than 2^(IDbits+1) will be considered
                 * as out of range and dropped by GIC.
                 * So we initialize IDbits to known value to avoid VLPI drop.
                 */
                val = (LPI_NRBITS - 1) & GICR_VPROPBASER_IDBITS_MASK;
                pr_debug("GICv4: CPU%d: Init IDbits to 0x%llx for GICR_VPROPBASER\n",
                        smp_processor_id(), val);
                gits_write_vpropbaser(val, vlpi_base + GICR_VPROPBASER);

                /*
                 * Also clear Valid bit of GICR_VPENDBASER, in case some
                 * ancient programming gets left in and has possibility of
                 * corrupting memory.
                 */
                val = its_clear_vpend_valid(vlpi_base);
                WARN_ON(val & GICR_VPENDBASER_Dirty);
        }

        /* Make sure the GIC has seen the above */
        dsb(sy);
out:
        gic_data_rdist()->lpi_enabled = true;
        pr_info("GICv3: CPU%d: using %s LPI pending table @%pa\n",
                smp_processor_id(),
                gic_data_rdist()->pend_page ? "allocated" : "reserved",
                &paddr);
}
```

```c
static void its_cpu_init_collections(void)
{
        struct its_node *its;

        raw_spin_lock(&its_lock);

        list_for_each_entry(its, &its_nodes, entry)
                its_cpu_init_collection(its);

        raw_spin_unlock(&its_lock);
}

static void its_cpu_init_collection(struct its_node *its)
{
        int cpu = smp_processor_id();
        u64 target;

        /* avoid cross node collections and its mapping */
        if (its->flags & ITS_FLAGS_WORKAROUND_CAVIUM_23144) {
                struct device_node *cpu_node;

                cpu_node = of_get_cpu_node(cpu, NULL);
                if (its->numa_node != NUMA_NO_NODE &&
                        its->numa_node != of_node_to_nid(cpu_node))
                        return;
        }

        /*
         * We now have to bind each collection to its target
         * redistributor.
         */
        if (gic_read_typer(its->base + GITS_TYPER) & GITS_TYPER_PTA) {
                /*
                 * This ITS wants the physical address of the
                 * redistributor.
                 */
                target = gic_data_rdist()->phys_base;
        } else {
                /* This ITS wants a linear CPU number. */
                target = gic_read_typer(gic_data_rdist_rd_base() + GICR_TYPER);
                target = GICR_TYPER_CPU_NUMBER(target) << 16;
        }

        /* Perform collection mapping */
        its->collections[cpu].target_address = target;
        its->collections[cpu].col_id = cpu;

        its_send_mapc(its, &its->collections[cpu], 1);
        its_send_invall(its, &its->collections[cpu]);
}
```

## Virtualization

### Model and Data Structures

#### Data structures

* `struct its_device`: a device
* `struct its_ite`: triple `(eventid, irq, collection)`

#### Helper

* `find_ite` is used to find an interrupt translation table
  entry (`struct its_ite`) for a given `(Device ID, Event ID)` on
  an ITS.

```c
static struct its_ite *find_ite(struct vgic_its *its, u32 device_id,
                                  u32 event_id)
{
        struct its_device *device;
        struct its_ite *ite;

        device = find_its_device(its, device_id);
        if (device == NULL)
                return NULL;

        list_for_each_entry(ite, &device->itt_head, ite_list)
                if (ite->event_id == event_id)
                        return ite;

        return NULL;
}
```

### API

#### ioctl KVM_DEV_ARM_ITS_CTRL_RESET

```c
/* virt/kvm/arm/vgic/vgic-its.c */

static void vgic_its_reset(struct kvm *kvm, struct vgic_its *its)
{
        /* We need to keep the ABI specific field values */
        its->baser_coll_table &= ~GITS_BASER_VALID;
        its->baser_device_table &= ~GITS_BASER_VALID;
        its->cbaser = 0;
        its->creadr = 0;
        its->cwriter = 0;
        its->enabled = 0;
        vgic_its_free_device_list(kvm, its);
        vgic_its_free_collection_list(kvm, its);
}
```

#### ioctl KVM_DEV_ARM_ITS_SAVE_TABLES

Save the ITS tables into guest ARM.

```c
static int vgic_its_save_tables_v0(struct vgic_its *its)
{
        int ret;

        ret = vgic_its_save_device_tables(its);
        if (ret)
                return ret;

        return vgic_its_save_collection_table(its);
}
```

#### ioctl KVM_DEV_ARM_ITS_RESTORE_TABLES

Restore the ITS tables from guest RAM to internal data
structs.

```c
/**
 * vgic_its_restore_tables_v0 - Restore the ITS tables from guest RAM
 * to internal data structs according to V0 ABI
 */
static int vgic_its_restore_tables_v0(struct vgic_its *its)
{
        int ret;

        ret = vgic_its_restore_collection_table(its);
        if (ret)
                return ret;

        return vgic_its_restore_device_tables(its);
}
```



## Reference

> http://bos.itdks.com/855dbb545f004e9da1c603f3bcc0a917.pdf