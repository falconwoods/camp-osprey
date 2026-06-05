import { describe, it, expect } from 'vitest'
import {
  reservePasses,
  extractCampsiteName,
  extractSelectedCampsiteName,
  findBookingConfirmation,
  findDetailsControl,
  findReserveControl,
  hasNoAvailabilityMessage,
  hasListResultOutcome,
  isExpansionPanelOpen,
} from '../../src/content/reserveStrategy'

describe('reservePasses', () => {
  it('uses any eligible site immediately in speed-first mode', () => {
    expect(reservePasses()).toEqual(['any'])
  })
})

describe('extractCampsiteName', () => {
  it('extracts alphanumeric campsite names from panel text', () => {
    expect(extractCampsiteName('Campsite H10 Available Details')).toBe('H10')
  })
})

describe('extractSelectedCampsiteName', () => {
  it('prefers the panel body over shifted header text', () => {
    expect(extractSelectedCampsiteName('Campsite A20 Available', 'Campsite A22 Available')).toBe('A20')
  })
})

describe('findDetailsControl', () => {
  it('finds Details when BC Parks renders it as a button', () => {
    document.body.innerHTML = '<section><button>Details</button></section>'

    expect(findDetailsControl(document.body)).toBe(document.querySelector('button'))
  })

  it('finds Details when BC Parks renders it as a non-button clickable control', () => {
    document.body.innerHTML = '<section><a href="/details">Details</a></section>'

    expect(findDetailsControl(document.body)).toBe(document.querySelector('a'))
  })

  it('finds Details when BC Parks exposes it as a role button', () => {
    document.body.innerHTML = '<section><span role="button">Details</span></section>'

    expect(findDetailsControl(document.body)).toBe(document.querySelector('[role="button"]'))
  })

  it('finds Details when the expansion header includes surrounding site text', () => {
    document.body.innerHTML = `
      <mat-expansion-panel-header role="button">
        <span>Campsite 27</span>
        <span>Available</span>
        <span>Details</span>
      </mat-expansion-panel-header>
    `

    expect(findDetailsControl(document.body)).toBe(document.querySelector('[role="button"]'))
  })
})

describe('findReserveControl', () => {
  it('finds the BC Parks reserve-button class when present', () => {
    document.body.innerHTML = '<section><button class="reserve-button">Reserve</button></section>'

    expect(findReserveControl(document.body)).toBe(document.querySelector('button'))
  })

  it('finds the visible Reserve button even when the reserve-button class is missing', () => {
    document.body.innerHTML = '<section><button class="mat-mdc-button">Reserve</button></section>'

    expect(findReserveControl(document.body)).toBe(document.querySelector('button'))
  })

  it('finds Reserve when BC Parks renders it as a role button', () => {
    document.body.innerHTML = '<section><span role="button">Reserve</span></section>'

    expect(findReserveControl(document.body)).toBe(document.querySelector('[role="button"]'))
  })

  it('ignores Reserve controls inside inert collapsed panel content', () => {
    document.body.innerHTML = `
      <mat-expansion-panel>
        <div class="mat-expansion-panel-content-wrapper" inert>
          <button class="reserve-button">Reserve</button>
        </div>
      </mat-expansion-panel>
    `

    expect(findReserveControl(document.body)).toBeNull()
  })
})

describe('hasNoAvailabilityMessage', () => {
  it('detects the BC Parks no availability results screen', () => {
    document.body.innerHTML = `
      <main>
        <h2>No Available Campsites</h2>
        <p>There are no available campsites at this location that match your search.</p>
      </main>
    `

    expect(hasNoAvailabilityMessage(document.body)).toBe(true)
  })

  it('does not treat normal campsite lists as unavailable', () => {
    document.body.innerHTML = `
      <main>
        <mat-expansion-panel class="list-entry">Campsite 52 Available</mat-expansion-panel>
      </main>
    `

    expect(hasNoAvailabilityMessage(document.body)).toBe(false)
  })
})

describe('hasListResultOutcome', () => {
  it('treats the BC Parks no availability panel as a completed list outcome', () => {
    document.body.innerHTML = `
      <app-legacy-list-view>
        <div class="list-wrapper">
          <div class="expansion-panel">
            <div class="expansion-details full-width availability-panel">
              <h2>No Available Campsites</h2>
              <p>There are no available campsites at this location that match your search.</p>
            </div>
          </div>
        </div>
      </app-legacy-list-view>
    `

    expect(hasListResultOutcome(document.body)).toBe(true)
  })

  it('treats category buttons as a completed list outcome', () => {
    document.body.innerHTML = '<button class="map-link-button">Campground</button>'

    expect(hasListResultOutcome(document.body)).toBe(true)
  })
})

describe('isExpansionPanelOpen', () => {
  it('uses header aria-expanded when BC Parks has not set mat-expanded on the panel', () => {
    document.body.innerHTML = `
      <mat-expansion-panel>
        <mat-expansion-panel-header role="button" aria-expanded="true">Campsite 27 Details</mat-expansion-panel-header>
      </mat-expansion-panel>
    `

    expect(isExpansionPanelOpen(
      document.querySelector('mat-expansion-panel')!,
      document.querySelector('mat-expansion-panel-header'),
    )).toBe(true)
  })

  it('uses the expanded panel class when present', () => {
    document.body.innerHTML = `
      <mat-expansion-panel class="mat-expanded">
        <mat-expansion-panel-header role="button" aria-expanded="false">Campsite 27 Details</mat-expansion-panel-header>
      </mat-expansion-panel>
    `

    expect(isExpansionPanelOpen(
      document.querySelector('mat-expansion-panel')!,
      document.querySelector('mat-expansion-panel-header'),
    )).toBe(true)
  })
})

describe('findBookingConfirmation', () => {
  it('detects the recorded BC Parks success page structure', () => {
    document.body.innerHTML = `
      <app-checkout-confirmation>
        <h1 id="pageTitle">Success!</h1>
        <div id="confirmationMessage_1">
          You have successfully made a reservation for <strong>Campsite 18</strong>.
        </div>
        <div class="success-reference" id="referenceNumber_1">
          <p class="success-reference-number"> Reservation Number: BCIN123B1 </p>
        </div>
      </app-checkout-confirmation>
    `

    expect(findBookingConfirmation(
      document,
      'https://camping.bcparks.ca/create-booking/confirmation/cart/transaction',
    )).toMatchObject({
      confirmationNumber: 'BCIN123B1',
    })
  })

  it('does not treat non-confirmation checkout pages as paid', () => {
    document.body.innerHTML = `
      <app-create-booking>
        <h1 id="pageTitle">Payment</h1>
        <button>Apply credit card payment</button>
      </app-create-booking>
    `

    expect(findBookingConfirmation(
      document,
      'https://camping.bcparks.ca/create-booking/payment/create-booking%2Fconfirmation',
    )).toBeNull()
  })
})
