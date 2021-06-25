# kprobes

`kprobes`可以在内核中插入断点.

`register_kprobe`, `unregister_kprobe`接口使得可以在内核中插入, 删除断点.

## struct kprobe

```c
struct kprobe {
        struct hlist_node hlist;

        /* list of kprobes for multi-handler support */
        struct list_head list;

        /*count the number of times this probe was temporarily disarmed */
        unsigned long nmissed;

        /* location of the probe point */
        kprobe_opcode_t *addr;

        /* Allow user to indicate symbol name of the probe point */
        const char *symbol_name;

        /* Offset into the symbol */
        unsigned int offset;

        /* Called before addr is executed. */
        kprobe_pre_handler_t pre_handler;

        /* Called after addr is executed, unless... */
        kprobe_post_handler_t post_handler;

        /*
         * ... called if executing addr causes a fault (eg. page fault).
         * Return 1 if it handled fault, otherwise kernel will see it.
         */
        kprobe_fault_handler_t fault_handler;

        /* Saved opcode (which has been replaced with breakpoint) */
        kprobe_opcode_t opcode;

        /* copy of the original instruction */
        struct arch_specific_insn ainsn;

        /*
         * Indicates various status flags.
         * Protected by kprobe_mutex after this kprobe is registered.
         */
        u32 flags;
};
```

例如

```c
static char symbol[MAX_SYMBOL_LEN] = "_do_fork";
static struct kprobe kp = {
	.symbol_name = symbol,
	.pre_handler = handler_pre,
	.post_handler = handler_post,
	.fault_handler = handler_fault,
};

register_kprobe(&kp);
```

注意

* `addr`和`symbol_name`只能设置一个

## register_kprobe

```c
int register_kprobe(struct kprobe *p)
{
        int ret;
        struct kprobe *old_p;
        struct module *probed_mod;
        kprobe_opcode_t *addr;

        /* Adjust probe address from symbol */
	// 如果设置的是symbol name, 转换成addr然后加上offset
        addr = kprobe_addr(p);
        if (IS_ERR(addr))
                return PTR_ERR(addr);
        p->addr = addr;

	// 根据addr看是否有相同的probe
        ret = check_kprobe_rereg(p);
        if (ret)
                return ret;

        /* User can pass only KPROBE_FLAG_DISABLED to register_kprobe */
        p->flags &= KPROBE_FLAG_DISABLED;
        p->nmissed = 0;
        INIT_LIST_HEAD(&p->list);

	// probe只能插在kernel的代码段, 且不在blacklist里, 且不是reserved, 且
	// 不在bug table中. 若断点在module中, probed_mod记录module
        ret = check_kprobe_address_safe(p, &probed_mod);
        if (ret)
                return ret;

        mutex_lock(&kprobe_mutex);

        old_p = get_kprobe(p->addr);
        if (old_p) {
                /* Since this may unoptimize old_p, locking text_mutex. */
                ret = register_aggr_kprobe(old_p, p);
                goto out;
        }

        cpus_read_lock();
        /* Prevent text modification */
        mutex_lock(&text_mutex);
        ret = prepare_kprobe(p);
        mutex_unlock(&text_mutex);
        cpus_read_unlock();
        if (ret)
                goto out;

        INIT_HLIST_NODE(&p->hlist);
        hlist_add_head_rcu(&p->hlist,
                       &kprobe_table[hash_ptr(p->addr, KPROBE_HASH_BITS)]);

        if (!kprobes_all_disarmed && !kprobe_disabled(p)) {
                ret = arm_kprobe(p);
                if (ret) {
                        hlist_del_rcu(&p->hlist);
                        synchronize_rcu();
                        goto out;
                }
        }

        /* Try to optimize kprobe */
        try_to_optimize_kprobe(p);
out:
        mutex_unlock(&kprobe_mutex);

        if (probed_mod)
                module_put(probed_mod);

        return ret;
}
```

## setup kprobe

设置断点的逻辑在

```c
static void __arm_kprobe(struct kprobe *p)
{
        struct kprobe *_p;

        /* Check collision with other optimized kprobes */
        _p = get_optimized_kprobe((unsigned long)p->addr);
        if (unlikely(_p))
                /* Fallback to unoptimized kprobe */
                unoptimize_kprobe(_p, true);

        arch_arm_kprobe(p);
        optimize_kprobe(p);     /* Try to optimize (add kprobe to a list) */
}
```

取决于不通的体系结构, `arch_arm_kprobe`有不同的实现. 例如`x86`使用的指令是`int3`

```c
void arch_arm_kprobe(struct kprobe *p)
{
        u8 int3 = INT3_INSN_OPCODE;

        text_poke(p->addr, &int3, 1);
        text_poke_sync();
        perf_event_text_poke(p->addr, &p->opcode, 1, &int3, 1);
}
```

## handler

以`x86`为例, 如果发生了`int3`中断

```c
static bool do_int3(struct pt_regs *regs)
{
        int res;

#ifdef CONFIG_KGDB_LOW_LEVEL_TRAP
        if (kgdb_ll_trap(DIE_INT3, "int3", regs, 0, X86_TRAP_BP,
                         SIGTRAP) == NOTIFY_STOP)
                return true;
#endif /* CONFIG_KGDB_LOW_LEVEL_TRAP */

#ifdef CONFIG_KPROBES
        if (kprobe_int3_handler(regs))
                return true;
#endif
        res = notify_die(DIE_INT3, "int3", regs, 0, X86_TRAP_BP, SIGTRAP);

        return res == NOTIFY_STOP;
}
```

进入`kprobe_int3_handler`函数. 里面会根据addr看是否注册`kprobe`, 若有则执行
`kprobe`里的函数.

```c
/*
 * Interrupts are disabled on entry as trap3 is an interrupt gate and they
 * remain disabled throughout this function.
 */
int kprobe_int3_handler(struct pt_regs *regs)
{
        kprobe_opcode_t *addr;
        struct kprobe *p;
        struct kprobe_ctlblk *kcb;

        if (user_mode(regs))
                return 0;

        addr = (kprobe_opcode_t *)(regs->ip - sizeof(kprobe_opcode_t));
        /*
         * We don't want to be preempted for the entire duration of kprobe
         * processing. Since int3 and debug trap disables irqs and we clear
         * IF while singlestepping, it must be no preemptible.
         */

        kcb = get_kprobe_ctlblk();
        p = get_kprobe(addr);

        if (p) {
                // ...
        } else if (*addr != INT3_INSN_OPCODE) {
                /*
                 * The breakpoint instruction was removed right
                 * after we hit it.  Another cpu has removed
                 * either a probepoint or a debugger breakpoint
                 * at this address.  In either case, no further
                 * handling of this interrupt is appropriate.
                 * Back up over the (now missing) int3 and run
                 * the original instruction.
                 */
                regs->ip = (unsigned long)addr;
                return 1;
        } /* else: not a kprobe fault; let the kernel handle it */

        return 0;
}
```