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

## Message Signalled Interrupts (MSI)

### MSI types

* MSI
* MSI-X

## Structure

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