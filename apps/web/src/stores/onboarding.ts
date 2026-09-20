import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { isMobile } from '@surstromming/util'
import type { MessageKey } from '@/i18n/messages'
import { useSidebar } from '@/stores/sidebar'

/** One stop on the tour: what it rings, and what it says about it. */
export type TourStep = {
  /** The `data-tour` attribute on the element to ring. */
  anchor: string
  title: MessageKey
  body: MessageKey
  /**
   * Whether the target lives in the sidebar. These are kept as one unbroken
   * run so the drawer slides open once and shut once — see docs/onboarding.md.
   */
  inSidebar: boolean
}

/**
 * Four stops, in this order. Only the furniture a first-time reader cannot find
 * on their own: the button that hides everything else, the two things behind
 * it, and the one control on the map that is not a bus.
 */
const steps: TourStep[] = [
  { anchor: 'menu', title: 'menu', body: 'tourMenuBody', inSidebar: false },
  { anchor: 'planner', title: 'planTrip', body: 'tourPlannerBody', inSidebar: true },
  { anchor: 'filter', title: 'routes', body: 'tourFilterBody', inSidebar: true },
  { anchor: 'locate', title: 'centreOnMe', body: 'tourLocateBody', inSidebar: false },
]

const welcomeKey = 'welcome-seen'
const menuKey = 'menu-used'

export const useOnboarding = defineStore('onboarding', () => {
  const sidebar = useSidebar()

  /** The first-visit offer has been answered — whichever way it was answered. */
  const welcomeSeen = ref(localStorage.getItem(welcomeKey) === 'true')
  /** The sidebar has been opened at least once on this device. */
  const menuUsed = ref(localStorage.getItem(menuKey) === 'true')
  /**
   * The sentence beside the ring has been waved away this visit. Not persisted,
   * and that is the point: someone who dismisses it in their first second
   * should not be left with an unexplained ring for ever.
   */
  const hintDismissed = ref(false)
  /**
   * Whether the first-visit offer is on screen. Set by the dialog, because only
   * it knows that the offer waits for the map page, and a store has no route.
   */
  const welcomeOpen = ref(false)

  /** Where the tour is, or null when it is not running. */
  const step = ref<number | null>(null)

  const running = computed(() => step.value !== null)
  const currentStep = computed(() => (step.value === null ? null : steps[step.value]))
  const onLastStep = computed(() => step.value === steps.length - 1)
  const stepCount = steps.length

  /**
   * The ring on the menu button. Phones only, and that is the whole reason for
   * it: there the panel is a drawer, so a reader who never presses the button
   * never sees the routes, the planner or the filter at all. On a desktop the
   * panel is simply open and needs nothing pointing at it.
   *
   * Not while the offer or the tour is up: those are the same first visit
   * talking, and all three at once is three people talking.
   */
  const ringMenu = computed(
    () => isMobile.value && !menuUsed.value && !running.value && !welcomeOpen.value,
  )

  /**
   * The sentence beside the ring. It goes when it is waved away; the ring
   * stays until the drawer has actually been opened, because being told what
   * is behind the button is not the same as having found it.
   */
  const hintMenu = computed(() => ringMenu.value && !hintDismissed.value)

  const answerWelcome = () => {
    welcomeSeen.value = true
    localStorage.setItem(welcomeKey, 'true')
  }

  const dismissHint = () => {
    hintDismissed.value = true
  }

  /** What the desktop panel was doing before the tour opened it, to put back. */
  let panelWasOpen = false

  const startTour = () => {
    panelWasOpen = sidebar.open
    step.value = 0
  }

  const endTour = () => {
    step.value = null
    sidebar.open = panelWasOpen
  }

  /** Forward one stop, or out the other end. Also how a missing target is skipped. */
  const advance = () => {
    if (step.value === null) return
    const next = step.value + 1
    if (next < steps.length) step.value = next
    else endTour()
  }

  // The sidebar has to be showing before a step can point into it. Closing it
  // again is only done on a phone, where the drawer covers both the header
  // button of the first step and the map of the last; on a desktop the panel is
  // left as the reader had it, and put back by `endTour`.
  watch(step, (index) => {
    if (index === null) return
    if (steps[index].inSidebar) sidebar.open = true
    else if (isMobile.value) sidebar.open = false
  })

  // Whoever opened it — the reader, or the tour on their behalf — the drawer
  // has now been found, and the ring has nothing left to say.
  watch(
    () => sidebar.open,
    (open) => {
      if (!open || menuUsed.value) return
      menuUsed.value = true
      localStorage.setItem(menuKey, 'true')
    },
  )

  return {
    welcomeSeen,
    welcomeOpen,
    ringMenu,
    hintMenu,
    step,
    running,
    currentStep,
    onLastStep,
    stepCount,
    answerWelcome,
    dismissHint,
    startTour,
    endTour,
    advance,
  }
})
