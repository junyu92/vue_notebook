# GIC

## Interrupt prioritization

Prioritization describes the

* Configuration and control of interrupt priority
* Order of execution of pending interrupts
* Determination of when interrupts are visible to a target PE,
  including
  * Interrupt priority masking
  * Priority grouping
  * Preemption of an active interrupt

Priority values are an 8-bit unsigned binary number.

### Preemption

A CPU interface supports signaling of higher priority pending
interrupts to a target PE before an active interrupt completes.

A pending interrupt is only signaled if both:

* Its priority is higher than the priority mask for that CPU
  interface
* Its group prioirty is higher than of the running priority on
  the CPU interface


## Virtualization

## Direct injection of virtual interrupts (GICv4)

GICv4 adds support for the direct injection of virtual LPIs (vLPIs).
This feature allows software to describe to the ITS how physical
events (EventID, DeviceID) map to virtual interrupts.

If the vPE targeted by interrupt is running, the virtual interrupt
can be forwarded without the need to first enter the hypervisor.
This can reduce the overhead associated with virtualized interrupts.

### Configuration

Registers:

* `GICR_VPROPBASER`: the address of the virtual LPI Configuration table.
  The configuration of vLPIs is global to all vPEs in the same VM.
* `GICR_VPENDBASER`: the address of virtual LPI Pending table. As with
  the physical LPI Pending table, the VPT records the pending state of
  the vLPIs. **Each vPE has its own private VPT**.

Two command can be used to map `(EventID, DeviceID)` to a `vINTID` and `vPE`.

* The `VMAPI` command is used when the EventID and vINTID are the same
  `VMAPI <DeviceID>, <EventID>, <Doorbell pINTID>, <vPE ID>`
* The `VMAPTI` command is used then the EventID and vINTID are different
  `VMAPTI <DeviceID>, <EventID>, <vINTID>, <pINTID>, <vPE ID>`

The ITS must be aware of which physical PE a vPE will be scheduled on
when it is running.
The `VMAPP` maps a vPE to a physical Redistributor.

`VMAPP <vPE ID>, <RDADDR>, <VPT>, <VPT size>`

* `<RDADDR>` is the target Redistributor.

```c
static int its_vlpi_map(struct irq_data *d, struct its_cmd_info *info)
{
        struct its_device *its_dev = irq_data_get_irq_chip_data(d);
        u32 event = its_get_event_id(d);
        int ret = 0;

        if (!info->map)
                return -EINVAL;

        mutex_lock(&its_dev->event_map.vlpi_lock);

        if (!its_dev->event_map.vm) {
                struct its_vlpi_map *maps;

                maps = kcalloc(its_dev->event_map.nr_lpis, sizeof(*maps),
                               GFP_KERNEL);
                if (!maps) {
                        ret = -ENOMEM;
                        goto out;
                }

                its_dev->event_map.vm = info->map->vm;
                its_dev->event_map.vlpi_maps = maps;
        } else if (its_dev->event_map.vm != info->map->vm) {
                ret = -EINVAL;
                goto out;
        }

        /* Get our private copy of the mapping information */
        its_dev->event_map.vlpi_maps[event] = *info->map;

        if (irqd_is_forwarded_to_vcpu(d)) {
                /* Already mapped, move it around */
                its_send_vmovi(its_dev, event);
        } else {
                /* Ensure all the VPEs are mapped on this ITS */
                its_map_vm(its_dev->its, info->map->vm);

                /*
                 * Flag the interrupt as forwarded so that we can
                 * start poking the virtual property table.
                 */
                irqd_set_forwarded_to_vcpu(d);

                /* Write out the property to the prop table */
                lpi_write_config(d, 0xff, info->map->properties);

                /* Drop the physical mapping */
                its_send_discard(its_dev, event);

                /* and install the virtual one */
                its_send_vmapti(its_dev, event);

                /* Increment the number of VLPIs */
                its_dev->event_map.nr_vlpis++;
        }

out:
        mutex_unlock(&its_dev->event_map.vlpi_lock);
        return ret;
}
```

The core function is `its_send_vmapti`.

```c
static void its_send_vmapti(struct its_device *dev, u32 id)
{
        struct its_vlpi_map *map = &dev->event_map.vlpi_maps[id];
        struct its_cmd_desc desc;

        desc.its_vmapti_cmd.vpe = map->vpe;
        desc.its_vmapti_cmd.dev = dev;
        desc.its_vmapti_cmd.virt_id = map->vintid;
        desc.its_vmapti_cmd.event_id = id;
        desc.its_vmapti_cmd.db_enabled = map->db_enabled;

        its_send_single_vcommand(dev->its, its_build_vmapti_cmd, &desc);
}
```

### Scheduled virtual PE

Virtual interrupts for the scheduled vPE can be directly injected. If
the target vPE is not scheduled, the virtual interrupt is recorded as
being pending in the appropriate VPT.

When performing a context swith between vPEs, a hypervisor must update
the Redistributor registers. This means that the hypervisor must:
* Clear `GICR_VPENDBASER.Valid`
* Poll `GICR_BPENDBASER.Dirty` until it reads 0
* Update `GICR_VPROPBASER`
* Update `GICR_VPROPBASER`, setting Valid==1 in the process

### inject interrupts

When a peripheral writes to `GITS_TRANSLATER`
1. The ITS uses the DeviceID to select the appropriate entry from the
   Device table. This entry identifies the Interrupt translation table
   to use.
2. The ITS uses the EventID to select the appropriate entry from the
   Interrupt translation table. This will return either:
   a. A pINTID and Collection ID
   b. A vINTID and vPE ID, and optionally a pINTID as a door-bell interrupt
3. The ITS uses the vPE ID to select the required entry in the vPE
   table and the vPE table
   **returns the target Redistributor and the address of the VPT of the vPE**.
4. The ITS forwards the vINTID, a door-bell interrupt and VPT address to the
   target Redistributor.
5. The Redistributor compares the VPT address from the ITS against the current
   `GICR_BPENDBASER`
   a. if the VPT address and current `GICR_BPENDBASER` match, the vPE is
      scheduled, and the vINTID is forwarded to the virtual CPU interface.
   b. if the VPT address and current `GICR_BPENDBASER` do not match, the
      vPE is not scheduled. The vINTID is set as pending in the VPT. If a
      door-bell interrupt was provided, the pINTID is forwarded to the physical
      CPU interface.

## Direct injection of virtual Software Generated Interrupts (SGIs)