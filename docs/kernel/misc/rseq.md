# Restartable Sequences

1. invoke syscall rseq to setup restartable sequences for caller thread

## Enable rseq for the current thread

register `rseq` and `rseq_sig` for current thread.

```c
        current->rseq = rseq;
        current->rseq_sig = sig;
        /*
         * If rseq was previously inactive, and has just been
         * registered, ensure the cpu_id_start and cpu_id fields
         * are updated before returning to user-space.
         */
        rseq_set_notify_resume(current);
```

`rseq_set_notify_resume` sets `TIF_NOTIFY_RESUME` for curernt thread flag.

```c
static inline void rseq_set_notify_resume(struct task_struct *t)
{
        if (t->rseq)
                set_tsk_thread_flag(t, TIF_NOTIFY_RESUME);
}
```

## Prior to exit to userspace

Prior to exit to userspace, kernel checks weather `_TIF_NOTIFY_RESUME` was setted.
If it was, `__rseq_handle_notify_resume` should be invoked.

```c
/*
 * This resume handler must always be executed between any of:
 * - preemption,
 * - signal delivery,
 * and return to user-space.
 *
 * This is how we can ensure that the entire rseq critical section
 * will issue the commit instruction only if executed atomically with
 * respect to other threads scheduled on the same CPU, and with respect
 * to signal handlers.
 */
void __rseq_handle_notify_resume(struct ksignal *ksig, struct pt_regs *regs)
{
        struct task_struct *t = current;
        int ret, sig;

        if (unlikely(t->flags & PF_EXITING))
                return;
        ret = rseq_ip_fixup(regs);
        if (unlikely(ret < 0))
                goto error;
        if (unlikely(rseq_update_cpu_id(t)))
                goto error;
        return;

error:
        sig = ksig ? ksig->sig : 0;
        force_sigsegv(sig);
}
```

## deregister

```c
SYSCALL_DEFINE4(rseq, struct rseq __user *, rseq, u32, rseq_len,
                int, flags, u32, sig)
{
	// ...

        if (flags & RSEQ_FLAG_UNREGISTER) {
                if (flags & ~RSEQ_FLAG_UNREGISTER)
                        return -EINVAL;
                /* Unregister rseq for current thread. */
                if (current->rseq != rseq || !current->rseq)
                        return -EINVAL;
                if (rseq_len != sizeof(*rseq))
                        return -EINVAL;
                if (current->rseq_sig != sig)
                        return -EPERM;
                ret = rseq_reset_rseq_cpu_id(current);
                if (ret)
                        return ret;
                current->rseq = NULL;
                current->rseq_sig = 0;
                return 0;
        }

	// ...
}
```