module.exports = {
  title: 'Hello VuePress',
  description: 'Just playing around',
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
            text: 'Sync',
            children: [
              '/kernel/sync/wait.md',
            ]
          },
          {
            text: 'IPC',
            children: [
              '/kernel/ipc/eventfd.md',
            ]
          },
          {
            text: 'trace',
            children: [
              '/kernel/trace/kprobes.md'
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
            ]
          },
        ]
      },
      {
        text: 'Debug',
        children: [
          '/debug/gdb_python.md'
        ]
      },
      {
        text: 'Qemu',
        children: [
          '/qemu/pci.md'
        ]
      },
    ]
  }
}
