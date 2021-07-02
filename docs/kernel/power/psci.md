# PSCI

Power State Coordination Interface (PSCI) has the following
uses:

* Provides a generic interface that supervisory software can use
  to manage power in the following situations:
  * core idle management
  * dynamic addition of cores to and removal of cores from the
    sysytem, often referred to as hotplug
  * secondary core boot
  * moving trusted OS context from one core to another
  * system shutdown and reset
* Provides an interface that supervisory software can use in
  conjunction with Firmware Table (FDT and ACPI) descriptions
  to support the generalization of power management code

## select operations for CPU

```dts
// ./arch/arm64/boot/dts/arm/foundation-v8-psci.dtsi
/ {
        psci {
                compatible = "arm,psci-1.0";
                method = "smc";
        };
};

&cpu0 {
        enable-method = "psci";
};

&cpu1 {
        enable-method = "psci";
};

&cpu2 {
        enable-method = "psci";
};

&cpu3 {
        enable-method = "psci";
};
```

```c
/**
 * struct cpu_operations - Callback operations for hotplugging CPUs.
 *
 * @name:       Name of the property as appears in a devicetree cpu node's
 *              enable-method property. On systems booting with ACPI, @name
 *              identifies the struct cpu_operations entry corresponding to
 *              the boot protocol specified in the ACPI MADT table.
 * @cpu_init:   Reads any data necessary for a specific enable-method for a
 *              proposed logical id.
 * @cpu_prepare: Early one-time preparation step for a cpu. If there is a
 *              mechanism for doing so, tests whether it is possible to boot
 *              the given CPU.
 * @cpu_boot:   Boots a cpu into the kernel.
 * @cpu_postboot: Optionally, perform any post-boot cleanup or necessary
 *              synchronisation. Called from the cpu being booted.
 * @cpu_can_disable: Determines whether a CPU can be disabled based on
 *              mechanism-specific information.
 * @cpu_disable: Prepares a cpu to die. May fail for some mechanism-specific
 *              reason, which will cause the hot unplug to be aborted. Called
 *              from the cpu to be killed.
 * @cpu_die:    Makes a cpu leave the kernel. Must not fail. Called from the
 *              cpu being killed.
 * @cpu_kill:  Ensures a cpu has left the kernel. Called from another cpu.
 * @cpu_init_idle: Reads any data necessary to initialize CPU idle states for
 *                 a proposed logical id.
 * @cpu_suspend: Suspends a cpu and saves the required context. May fail owing
 *               to wrong parameters or error conditions. Called from the
 *               CPU being suspended. Must be called with IRQs disabled.
 */
const struct cpu_operations cpu_psci_ops = {
        .name           = "psci",
        .cpu_init       = cpu_psci_cpu_init,
        .cpu_prepare    = cpu_psci_cpu_prepare,
        .cpu_boot       = cpu_psci_cpu_boot,
#ifdef CONFIG_HOTPLUG_CPU
        .cpu_can_disable = cpu_psci_cpu_can_disable,
        .cpu_disable    = cpu_psci_cpu_disable,
        .cpu_die        = cpu_psci_cpu_die,
        .cpu_kill       = cpu_psci_cpu_kill,
#endif
};
```

## PSCI interface

They are defined in `include/uapi/linux/psci.h`.

```c
#define PSCI_0_2_FN_PSCI_VERSION                PSCI_0_2_FN(0)
#define PSCI_0_2_FN_CPU_SUSPEND                 PSCI_0_2_FN(1)
#define PSCI_0_2_FN_CPU_OFF                     PSCI_0_2_FN(2)
#define PSCI_0_2_FN_CPU_ON                      PSCI_0_2_FN(3)
#define PSCI_0_2_FN_AFFINITY_INFO               PSCI_0_2_FN(4)
#define PSCI_0_2_FN_MIGRATE                     PSCI_0_2_FN(5)
#define PSCI_0_2_FN_MIGRATE_INFO_TYPE           PSCI_0_2_FN(6)
#define PSCI_0_2_FN_MIGRATE_INFO_UP_CPU         PSCI_0_2_FN(7)
#define PSCI_0_2_FN_SYSTEM_OFF                  PSCI_0_2_FN(8)
#define PSCI_0_2_FN_SYSTEM_RESET                PSCI_0_2_FN(9)

#define PSCI_0_2_FN64_CPU_SUSPEND               PSCI_0_2_FN64(1)
#define PSCI_0_2_FN64_CPU_ON                    PSCI_0_2_FN64(3)
#define PSCI_0_2_FN64_AFFINITY_INFO             PSCI_0_2_FN64(4)
#define PSCI_0_2_FN64_MIGRATE                   PSCI_0_2_FN64(5)
#define PSCI_0_2_FN64_MIGRATE_INFO_UP_CPU       PSCI_0_2_FN64(7)

#define PSCI_1_0_FN_PSCI_FEATURES               PSCI_0_2_FN(10)
#define PSCI_1_0_FN_SYSTEM_SUSPEND              PSCI_0_2_FN(14)
#define PSCI_1_0_FN_SET_SUSPEND_MODE            PSCI_0_2_FN(15)
#define PSCI_1_1_FN_SYSTEM_RESET2               PSCI_0_2_FN(18)

#define PSCI_1_0_FN64_SYSTEM_SUSPEND            PSCI_0_2_FN64(14)
#define PSCI_1_1_FN64_SYSTEM_RESET2             PSCI_0_2_FN64(18)

// ...
```

## Setup PSCI

```c
static const struct of_device_id psci_of_match[] __initconst = {
        { .compatible = "arm,psci",     .data = psci_0_1_init},
        { .compatible = "arm,psci-0.2", .data = psci_0_2_init},
        { .compatible = "arm,psci-1.0", .data = psci_1_0_init},
        {},
};
```

In this section, we only analyze version 0.2 (`psci_0_2_init`)

```c
/*
 * PSCI init function for PSCI versions >=0.2
 *
 * Probe based on PSCI PSCI_VERSION function
 */
static int __init psci_0_2_init(struct device_node *np)
{
        int err;

        err = get_set_conduit_method(np);
        if (err)
                return err;

        /*
         * Starting with v0.2, the PSCI specification introduced a call
         * (PSCI_VERSION) that allows probing the firmware version, so
         * that PSCI function IDs and version specific initialization
         * can be carried out according to the specific version reported
         * by firmware
         */
        return psci_probe();
}
```

### setup conduit

```c
static int get_set_conduit_method(struct device_node *np)
{
        const char *method;

        pr_info("probing for conduit method from DT.\n");

        if (of_property_read_string(np, "method", &method)) {
                pr_warn("missing \"method\" property\n");
                return -ENXIO;
        }

        if (!strcmp("hvc", method)) {
                set_conduit(SMCCC_CONDUIT_HVC);
        } else if (!strcmp("smc", method)) {
                set_conduit(SMCCC_CONDUIT_SMC);
        } else {
                pr_warn("invalid \"method\" property: %s\n", method);
                return -EINVAL;
        }
        return 0;
}

static void set_conduit(enum arm_smccc_conduit conduit)
{
        switch (conduit) {
        case SMCCC_CONDUIT_HVC:
                invoke_psci_fn = __invoke_psci_fn_hvc;
                break;
        case SMCCC_CONDUIT_SMC:
                invoke_psci_fn = __invoke_psci_fn_smc;
                break;
        default:
                WARN(1, "Unexpected PSCI conduit %d\n", conduit);
        }

        psci_conduit = conduit;
}

static unsigned long __invoke_psci_fn_hvc(unsigned long function_id,
                        unsigned long arg0, unsigned long arg1,
                        unsigned long arg2)
{
        struct arm_smccc_res res;

        arm_smccc_hvc(function_id, arg0, arg1, arg2, 0, 0, 0, 0, &res);
        return res.a0;
}

static unsigned long __invoke_psci_fn_smc(unsigned long function_id,
                        unsigned long arg0, unsigned long arg1,
                        unsigned long arg2)
{
        struct arm_smccc_res res;

        arm_smccc_smc(function_id, arg0, arg1, arg2, 0, 0, 0, 0, &res);
        return res.a0;
}
```

### psci_probe

```c
static int __init psci_probe(void)
{
        u32 ver = psci_0_2_get_version();

        pr_info("PSCIv%d.%d detected in firmware.\n",
                        PSCI_VERSION_MAJOR(ver),
                        PSCI_VERSION_MINOR(ver));

        if (PSCI_VERSION_MAJOR(ver) == 0 && PSCI_VERSION_MINOR(ver) < 2) {
                pr_err("Conflicting PSCI version detected.\n");
                return -EINVAL;
        }

        psci_0_2_set_functions();

        psci_init_migrate();

        if (PSCI_VERSION_MAJOR(ver) >= 1) {
                psci_init_smccc();
                psci_init_cpu_suspend();
                psci_init_system_suspend();
                psci_init_system_reset2();
                kvm_init_hyp_services();
        }

        return 0;
}
```

### setup functions

```c
static void __init psci_0_2_set_functions(void)
{
        pr_info("Using standard PSCI v0.2 function IDs\n");

        psci_ops = (struct psci_operations){
                .get_version = psci_0_2_get_version,
                .cpu_suspend = psci_0_2_cpu_suspend,
                .cpu_off = psci_0_2_cpu_off,
                .cpu_on = psci_0_2_cpu_on,
                .migrate = psci_0_2_migrate,
                .affinity_info = psci_affinity_info,
                .migrate_info_type = psci_migrate_info_type,
        };

        arm_pm_restart = psci_sys_reset;

        pm_power_off = psci_sys_poweroff;
}
```

### detect CPU running trusted OS

```c
static void __init psci_init_migrate(void)
{
        unsigned long cpuid;
        int type, cpu = -1;

        type = psci_ops.migrate_info_type();

        if (type == PSCI_0_2_TOS_MP) {
                pr_info("Trusted OS migration not required\n");
                return;
        }

        if (type == PSCI_RET_NOT_SUPPORTED) {
                pr_info("MIGRATE_INFO_TYPE not supported.\n");
                return;
        }

        if (type != PSCI_0_2_TOS_UP_MIGRATE &&
            type != PSCI_0_2_TOS_UP_NO_MIGRATE) {
                pr_err("MIGRATE_INFO_TYPE returned unknown type (%d)\n", type);
                return;
        }

        cpuid = psci_migrate_info_up_cpu();
        if (cpuid & ~MPIDR_HWID_BITMASK) {
                pr_warn("MIGRATE_INFO_UP_CPU reported invalid physical ID (0x%lx)\n",
                        cpuid);
                return;
        }

        cpu = get_logical_index(cpuid);
        resident_cpu = cpu >= 0 ? cpu : -1;

        pr_info("Trusted OS resident on physical CPU 0x%lx\n", cpuid);
}
```

## boot_secondary

When we boot CPU, `boot_secondary` should be invokoed.

```c
/*
 * Boot a secondary CPU, and assign it the specified idle task.
 * This also gives us the initial stack to use for this CPU.
 */
static int boot_secondary(unsigned int cpu, struct task_struct *idle)
{
        const struct cpu_operations *ops = get_cpu_ops(cpu);

        if (ops->cpu_boot)
                return ops->cpu_boot(cpu);

        return -EOPNOTSUPP;
}
```

Assume the CPU's enable-method is `psci`, the handler should be
`cpu_psci_cpu_boot`. The function first gets the physical address of
`secondary_entry` and then invokes `cpu_on` which was assigned with
`psci_0_2_cpu_on`.

```c
static int cpu_psci_cpu_boot(unsigned int cpu)
{
        int err = psci_ops.cpu_on(cpu_logical_map(cpu), __pa_symbol(secondary_entry));
        if (err)
                pr_err("failed to boot CPU%d (%d)\n", cpu, err);

        return err;
}
```

```c
static int psci_0_2_cpu_on(unsigned long cpuid, unsigned long entry_point)
{
        return __psci_cpu_on(PSCI_FN_NATIVE(0_2, CPU_ON), cpuid, entry_point);
}
```

## Virtualization

ARM/ARM64 KVM provides PSCI emulation for guest.

```c
/**
 * kvm_psci_call - handle PSCI call if r0 value is in range
 * @vcpu: Pointer to the VCPU struct
 *
 * Handle PSCI calls from guests through traps from HVC instructions.
 * The calling convention is similar to SMC calls to the secure world
 * where the function number is placed in r0.
 *
 * This function returns: > 0 (success), 0 (success but exit to user
 * space), and < 0 (errors)
 *
 * Errors:
 * -EINVAL: Unrecognized PSCI function
 */
static int kvm_psci_call(struct kvm_vcpu *vcpu)
{
        switch (kvm_psci_version(vcpu, vcpu->kvm)) {
        case KVM_ARM_PSCI_1_0:
                return kvm_psci_1_0_call(vcpu);
        case KVM_ARM_PSCI_0_2:
                return kvm_psci_0_2_call(vcpu);
        case KVM_ARM_PSCI_0_1:
                return kvm_psci_0_1_call(vcpu);
        default:
                return -EINVAL;
        };
}
```

```c
static int kvm_psci_0_2_call(struct kvm_vcpu *vcpu)
{
        struct kvm *kvm = vcpu->kvm;
        u32 psci_fn = smccc_get_function(vcpu);
        unsigned long val;
        int ret = 1;

        switch (psci_fn) {
        case PSCI_0_2_FN_PSCI_VERSION:
                /*
                 * Bits[31:16] = Major Version = 0
                 * Bits[15:0] = Minor Version = 2
                 */
                val = KVM_ARM_PSCI_0_2;
                break;
        case PSCI_0_2_FN_CPU_SUSPEND:
        case PSCI_0_2_FN64_CPU_SUSPEND:
                val = kvm_psci_vcpu_suspend(vcpu);
                break;
        case PSCI_0_2_FN_CPU_OFF:
                kvm_psci_vcpu_off(vcpu);
                val = PSCI_RET_SUCCESS;
                break;
        case PSCI_0_2_FN_CPU_ON:
        case PSCI_0_2_FN64_CPU_ON:
                mutex_lock(&kvm->lock);
                val = kvm_psci_vcpu_on(vcpu);
                mutex_unlock(&kvm->lock);
                break;
        case PSCI_0_2_FN_AFFINITY_INFO:
        case PSCI_0_2_FN64_AFFINITY_INFO:
                val = kvm_psci_vcpu_affinity_info(vcpu);
                break;
        case PSCI_0_2_FN_MIGRATE_INFO_TYPE:
                /*
                 * Trusted OS is MP hence does not require migration
                 * or
                 * Trusted OS is not present
                 */
                val = PSCI_0_2_TOS_MP;
                break;
        case PSCI_0_2_FN_SYSTEM_OFF:
                kvm_psci_system_off(vcpu);
                /*
                 * We should'nt be going back to guest VCPU after
                 * receiving SYSTEM_OFF request.
                 *
                 * If user space accidently/deliberately resumes
                 * guest VCPU after SYSTEM_OFF request then guest
                 * VCPU should see internal failure from PSCI return
                 * value. To achieve this, we preload r0 (or x0) with
                 * PSCI return value INTERNAL_FAILURE.
                 */
                val = PSCI_RET_INTERNAL_FAILURE;
                ret = 0;
                break;
        case PSCI_0_2_FN_SYSTEM_RESET:
                kvm_psci_system_reset(vcpu);
                /*
                 * Same reason as SYSTEM_OFF for preloading r0 (or x0)
                 * with PSCI return value INTERNAL_FAILURE.
                 */
                val = PSCI_RET_INTERNAL_FAILURE;
                ret = 0;
                break;
        default:
                val = PSCI_RET_NOT_SUPPORTED;
                break;
        }

        smccc_set_retval(vcpu, val, 0, 0, 0);
        return ret;
}
```