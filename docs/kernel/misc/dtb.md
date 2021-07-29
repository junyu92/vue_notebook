# Device Tree

## address

Devices that are addressable use the following properties
to encode address information into the device tree:

* reg
* #address-cells
* #size-cells

### Example

```dtb
    cpus {
        #address-cells = <1>;
        #size-cells = <0>;
        cpu@0 {
            compatible = "arm,cortex-a9";
            reg = <0>;
        };
        cpu@1 {
            compatible = "arm,cortex-a9";
            reg = <1>;
        };
    };
```

In this case, the two cpus are assigned addresses 0 and 1.
`#size-cells` is 0 for cpu nodes because each cpu is only
assigned a single address.

```
  {
    #address-cells = <1>;
    #size-cells = <1>;

    ...

    serial@101f0000 {
        compatible = "arm,pl011";
        reg = <0x101f0000 0x1000 >;
    };

    gpio@101f3000 {
        compatible = "arm,pl061";
        reg = <0x101f3000 0x1000
               0x101f4000 0x0010>;
    };
```

`serial@101f0000` has address `[0x101f0000, 0x101f1000)`.
`gpio` has two address ranges `[0x101f3000, 0x101f4000)` and
`[0x101f4000, 0x101f4010)`.