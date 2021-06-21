module.exports = {
  title: 'Hello VuePress',
  description: 'Just playing around',
  themeConfig: {
    sidebar: [
      {
        text: 'Kernel',
        children: [
          {
            text: 'Interrupt',
            children: [
              '/kernel/interrupt/its.md',
            ]
          }
        ]
      }
    ]
  }
}
