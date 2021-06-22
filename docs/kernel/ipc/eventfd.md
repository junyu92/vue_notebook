# eventfd

## signal

```c
__u64 eventfd_signal(struct eventfd_ctx *ctx, __u64 n)
{
        unsigned long flags;

        spin_lock_irqsave(&ctx->wqh.lock, flags);
        if (ULLONG_MAX - ctx->count < n)
                n = ULLONG_MAX - ctx->count;
        ctx->count += n;
        if (waitqueue_active(&ctx->wqh))
                wake_up_locked_poll(&ctx->wqh, EPOLLIN);
        spin_unlock_irqrestore(&ctx->wqh.lock, flags);

        return n;
}
```