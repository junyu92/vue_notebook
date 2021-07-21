module.exports = {
  title: 'Notebook',
  themeConfig: {
    sidebar: [
      {
        text: 'Kernel',
        children: [
          {
            text: 'boot',
            children: [
              '/kernel/boot/boot.md'
            ]
          },
          {
            text: 'Memory',
            children: [
              '/kernel/memory/memory_order.md',
              '/kernel/memory/cache.md',
              '/kernel/memory/arm64_fault.md',
              '/kernel/memory/virtualization.md'
            ]
          },
          {
            text: 'Driver',
            children: [
              '/kernel/driver/pci.md'
            ]
          },
          {
            text: 'Interrupt',
            children: [
              '/kernel/interrupt/interrupt_in_linux.md',
              '/kernel/interrupt/gic.md',
              '/kernel/interrupt/its.md',
            ]
          },
          {
            text: 'IPC and Sync',
            children: [
              '/kernel/ipc_and_sync/wait.md',
              '/kernel/ipc_and_sync/eventfd.md',
            ]
          },
          {
            text: 'Power',
            children: [
              '/kernel/power/psci.md',
            ]
          },
          {
            text: 'Trace',
            children: [
              '/kernel/trace/lockup.md',
              '/kernel/trace/kprobes.md',
              '/kernel/trace/walk_stack_on_arm.md',
              '/kernel/trace/aarch64_debug.md',
              '/kernel/trace/pmu.md',
              '/kernel/trace/spe.md',
            ]
          },
          {
            text: 'misc',
            children: [
              '/kernel/misc/export_symbol.md'
            ]
          },
          {
            text: 'Virtualization',
            children: [
              '/kernel/virtualization/vfio.md',
              '/kernel/virtualization/secure_virt.md',
            ]
          },
        ]
      },
      {
        text: 'Debug',
        children: [
          '/debug/gdb_python.md',
        ]
      },
      {
        text: 'Qemu',
        children: [
          '/qemu/pci.md'
        ]
      },
    ]
  },
  plugins: [
    '@vuepress/back-to-top',
  ]
}
