export default defineContentScript({
  matches: ['https://camping.bcparks.ca/*'],
  runAt: 'document_idle',
  main() {
    void import('../src/content/bcparks')
  },
})
