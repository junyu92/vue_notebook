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

```c
/**
 * vgic_its_save_tables_v0 - Save the ITS tables into guest ARM
 * according to v0 ABI
 */
static int vgic_its_save_tables_v0(struct vgic_its *its)
{
        int ret;

        ret = vgic_its_save_device_tables(its);
        if (ret)
                return ret;

        return vgic_its_save_collection_table(its);
}
```

## Reference

> http://bos.itdks.com/855dbb545f004e9da1c603f3bcc0a917.pdf