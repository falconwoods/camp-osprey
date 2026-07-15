export default defineContentScript({
  matches: ['https://camping.bcparks.ca/*', 'https://reservation.pc.gc.ca/*'],
  runAt: 'document_idle',
  main() {
    if (window.location.hostname === 'reservation.pc.gc.ca') {
      void import('../src/content/parksCanada')
      return
    }
    void import('../src/content/bcparks')
  },
})
