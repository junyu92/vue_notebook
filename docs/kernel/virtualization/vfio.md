# VFIO

## PCI configuration space

guest OS configures PCI device triggers MMIO abort, and QEMU
should invoke `vfio_pci_write_config` to handle it.

## MSI

MSIs are initialized after guest started running.

```
vfio_realize
  - vfio_get_device
  - vfio_msix_early_setup: gets msi-x info
  - vfio_add_capabilities
      - vfio_add_std_cap
          - vfio_msi_setup
          - vfio_msix_setup

(guest running)
vfio_pci_write_config
  - vfio_msi_enable
  - vfio_msix_enable: enables msix interruption
```

### MSI configuration

```c
void vfio_pci_write_config(PCIDevice *pdev,
                           uint32_t addr, uint32_t val, int len)
{
    /* ... */

    /* MSI/MSI-X Enabling/Disabling */
    if (pdev->cap_present & QEMU_PCI_CAP_MSI &&
        ranges_overlap(addr, len, pdev->msi_cap, vdev->msi_cap_size)) {
        int is_enabled, was_enabled = msi_enabled(pdev);

        pci_default_write_config(pdev, addr, val, len);

        is_enabled = msi_enabled(pdev);

        if (!was_enabled) {
            if (is_enabled) {
                vfio_msi_enable(vdev);
            }
        } else {
            if (!is_enabled) {
                vfio_msi_disable(vdev);
            } else {
                vfio_update_msi(vdev);
            }
        }
    }

    /* ... */
}
```

```c
static void vfio_msi_enable(VFIOPCIDevice *vdev)
{
    int ret, i;

    vfio_disable_interrupts(vdev);

    vdev->nr_vectors = msi_nr_vectors_allocated(&vdev->pdev);
retry:
    vdev->msi_vectors = g_new0(VFIOMSIVector, vdev->nr_vectors);

    for (i = 0; i < vdev->nr_vectors; i++) {
        VFIOMSIVector *vector = &vdev->msi_vectors[i];

        vector->vdev = vdev;
        vector->virq = -1;
        vector->use = true;

        if (event_notifier_init(&vector->interrupt, 0)) {
            error_report("vfio: Error: event_notifier_init failed");
        }

        qemu_set_fd_handler(event_notifier_get_fd(&vector->interrupt),
                            vfio_msi_interrupt, NULL, vector);

        /*
         * Attempt to enable route through KVM irqchip,
         * default to userspace handling if unavailable.
         */
        vfio_add_kvm_msi_virq(vdev, vector, i, false);
    }

    /* Set interrupt type prior to possible interrupts */
    vdev->interrupt = VFIO_INT_MSI;

    ret = vfio_enable_vectors(vdev, false);
    if (ret) {
        if (ret < 0) {
            error_report("vfio: Error: Failed to setup MSI fds: %m");
        } else if (ret != vdev->nr_vectors) {
            error_report("vfio: Error: Failed to enable %d "
                         "MSI vectors, retry with %d", vdev->nr_vectors, ret);
        }

        for (i = 0; i < vdev->nr_vectors; i++) {
            VFIOMSIVector *vector = &vdev->msi_vectors[i];
            if (vector->virq >= 0) {
                vfio_remove_kvm_msi_virq(vector);
            }
            qemu_set_fd_handler(event_notifier_get_fd(&vector->interrupt),
                                NULL, NULL, NULL);
            event_notifier_cleanup(&vector->interrupt);
#ifdef CONFIG_LIVE_UPGRADE
            local_mig_unregister_vfio_fd_name(vector->interrupt.rfd,
                    vdev->vbasedev.name,
                    LOCAL_MIGRATION_FD_VFIO_EVENTFD,
                    LOCAL_MIGRATION_FD_VFIO_EVENTFD_END);
#endif
        }

        g_free(vdev->msi_vectors);

        if (ret > 0 && ret != vdev->nr_vectors) {
            vdev->nr_vectors = ret;
            goto retry;
        }
        vdev->nr_vectors = 0;

        /*
         * Failing to setup MSI doesn't really fall within any specification.
         * Let's try leaving interrupts disabled and hope the guest figures
         * out to fall back to INTx for this device.
         */
        error_report("vfio: Error: Failed to enable MSI");
        vdev->interrupt = VFIO_INT_NONE;

        return;
    }

    trace_vfio_msi_enable(vdev->vbasedev.name, vdev->nr_vectors);
}
```

### MSI-X configuration

```c
void vfio_pci_write_config(PCIDevice *pdev,
                           uint32_t addr, uint32_t val, int len)
{
    /* ... */

    else if (pdev->cap_present & QEMU_PCI_CAP_MSIX &&
        ranges_overlap(addr, len, pdev->msix_cap, MSIX_CAP_LENGTH)) {
        int is_enabled, was_enabled = msix_enabled(pdev);

        pci_default_write_config(pdev, addr, val, len);

        is_enabled = msix_enabled(pdev);

        if (!was_enabled && is_enabled) {
            vfio_msix_enable(vdev);
        } else if (was_enabled && !is_enabled) {
            vfio_msix_disable(vdev);
        }
    }

    /* ... */
}
```

```c
static void vfio_msix_enable(VFIOPCIDevice *vdev)
{
    vfio_disable_interrupts(vdev);

    vdev->msi_vectors = g_new0(VFIOMSIVector, vdev->msix->entries);

    vdev->interrupt = VFIO_INT_MSIX;

    /*
     * Some communication channels between VF & PF or PF & fw rely on the
     * physical state of the device and expect that enabling MSI-X from the
     * guest enables the same on the host.  When our guest is Linux, the
     * guest driver call to pci_enable_msix() sets the enabling bit in the
     * MSI-X capability, but leaves the vector table masked.  We therefore
     * can't rely on a vector_use callback (from request_irq() in the guest)
     * to switch the physical device into MSI-X mode because that may come a
     * long time after pci_enable_msix().  This code enables vector 0 with
     * triggering to userspace, then immediately release the vector, leaving
     * the physical device with no vectors enabled, but MSI-X enabled, just
     * like the guest view.
     */
    vfio_msix_vector_do_use(&vdev->pdev, 0, NULL, NULL);
    vfio_msix_vector_release(&vdev->pdev, 0);

    if (msix_set_vector_notifiers(&vdev->pdev, vfio_msix_vector_use,
                                  vfio_msix_vector_release, NULL)) {
        error_report("vfio: msix_set_vector_notifiers failed");
    }

    trace_vfio_msix_enable(vdev->vbasedev.name);
}
```

```c
static int vfio_msix_vector_do_use(PCIDevice *pdev, unsigned int nr,
                                   MSIMessage *msg, IOHandler *handler)
{
    VFIOPCIDevice *vdev = DO_UPCAST(VFIOPCIDevice, pdev, pdev);
    VFIOMSIVector *vector;
    int ret;

    trace_vfio_msix_vector_do_use(vdev->vbasedev.name, nr);

    vector = &vdev->msi_vectors[nr];

    if (!vector->use) {
        vector->vdev = vdev;
        vector->virq = -1;
        if (event_notifier_init(&vector->interrupt, 0)) {
            error_report("vfio: Error: event_notifier_init failed");
        }
        vector->use = true;
        msix_vector_use(pdev, nr);
    }

    qemu_set_fd_handler(event_notifier_get_fd(&vector->interrupt),
                        handler, NULL, vector);

    /*
     * Attempt to enable route through KVM irqchip,
     * default to userspace handling if unavailable.
     */
    if (vector->virq >= 0) {
        if (!msg) {
            vfio_remove_kvm_msi_virq(vector);
        } else {
            vfio_update_kvm_msi_virq(vector, *msg, pdev);
        }
    } else {
        if (msg) {
            vfio_add_kvm_msi_virq(vdev, vector, nr, true);
        }
    }

    /*
     * We don't want to have the host allocate all possible MSI vectors
     * for a device if they're not in use, so we shutdown and incrementally
     * increase them as needed.
     */
    if (vdev->nr_vectors < nr + 1) {
        vfio_disable_irqindex(&vdev->vbasedev, VFIO_PCI_MSIX_IRQ_INDEX);
        vdev->nr_vectors = nr + 1;
        ret = vfio_enable_vectors(vdev, true);
        if (ret) {
            error_report("vfio: failed to enable vectors, %d", ret);
        }
    } else {
        int argsz;
        struct vfio_irq_set *irq_set;
        int32_t *pfd;

        argsz = sizeof(*irq_set) + sizeof(*pfd);

        irq_set = g_malloc0(argsz);
        irq_set->argsz = argsz;
        irq_set->flags = VFIO_IRQ_SET_DATA_EVENTFD |
                         VFIO_IRQ_SET_ACTION_TRIGGER;
        irq_set->index = VFIO_PCI_MSIX_IRQ_INDEX;
        irq_set->start = nr;
        irq_set->count = 1;
        pfd = (int32_t *)&irq_set->data;

        if (vector->virq >= 0) {
            *pfd = event_notifier_get_fd(&vector->kvm_interrupt);
        } else {
            *pfd = event_notifier_get_fd(&vector->interrupt);
        }

        ret = ioctl(vdev->vbasedev.fd, VFIO_DEVICE_SET_IRQS, irq_set);
        g_free(irq_set);
        if (ret) {
            error_report("vfio: failed to modify vector, %d", ret);
        }
    }

    /* Disable PBA emulation when nothing more is pending. */
    clear_bit(nr, vdev->msix->pending);
    if (find_first_bit(vdev->msix->pending,
                       vdev->nr_vectors) == vdev->nr_vectors) {
        memory_region_set_enabled(&vdev->pdev.msix_pba_mmio, false);
        trace_vfio_msix_pba_disable(vdev->vbasedev.name);
    }

    return 0;
}
```

## eventfd

irqfd and ioeventfd are both based on eventfd

* *irqfd*: inject intruction into guest
* *ioeventfd*: device signals the drivers(QEMU)

## irqfd

### Host registers irq for vfio device

`ioctl VFIO_DEVICE_SET_IRQS` is used to register interruption handler.

::: warning
todo
:::

### Hardware trigers interrupt

When hardware triggers an interrupt, `gic_handle_irq` should handle it.

Since the irq was registered via `vfio_msi_set_vector_signal`,
the handler function is `vfio_msihandler`.

```c
static int vfio_msi_set_vector_signal(struct vfio_pci_device *vdev,
                                      int vector, int fd, bool msix)
{
        /* ... */

        ret = request_irq(irq, vfio_msihandler, 0,
                          vdev->ctx[vector].name, trigger);

        /* ... */
}

/*
 * MSI/MSI-X
 */
static irqreturn_t vfio_msihandler(int irq, void *arg)
{
        struct eventfd_ctx *trigger = arg;

        eventfd_signal(trigger, 1);
        return IRQ_HANDLED;
}
```

Let's ignore the defails of eventfd.



::: details
Here is how the device injects interruption into guest.

```
        __vgic_its_check_cache+0
        kvm_arch_set_irq_inatomic+140
        irqfd_wakeup+228
        __wake_up_common+144
        __wake_up_locked_key+64
        eventfd_signal+144
        vfio_msihandler+36
        __handle_irq_event_percpu+120
        handle_irq_event_percpu+64
        handle_irq_event+76
        handle_fasteoi_irq+212
        generic_handle_irq+52
        __handle_domain_irq+108
        gic_handle_irq+212
        el[x]_irq
```
:::

## Q&A

* When an interrupt triggered, how the kernel receives `device_id`?

The `device_id` is stored within `struct kvm_kernel_irq_routing_entry`
(see `kvm_arch_set_irq_inatomic` for more details).

The content of `struct kvm_kernel_irq_routing_entry` was initialized
within function `kvm_set_routing_entry` which had called by
`ioctl KVM_SET_GSI_ROUTING`.

## Reference

> https://kernelgo.org/vfio-insight.html