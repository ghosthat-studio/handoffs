/** One thing to tick off on a handoff card. */
export type Step = { text: string; isDone: boolean }

/** A web page the card points to: an Open button. */
export type Link = { label: string; url: string }

/** One request Claude handed to the person, as a card in the Handoffs pane. */
export type Handoff = {
  /** `h1`, `h2`, ... in the order they arrived; or the id Claude gave the block. */
  id: string
  title: string
  /** What is needed, in a sentence. */
  need: string
  /** Why it is needed. */
  why: string
  steps: Step[]
  /** The decision buttons, in order; empty when there is nothing to decide. */
  options: string[]
  /** The option the person picked, or null. */
  pick: string | null
  /** Local files Claude wants reviewed, as written in the block. */
  reviews: string[]
  /** Web pages: `link:` lines, `review:` lines that are URLs, and URLs inside the card's text. */
  links: Link[]
  /** Shell commands for the person to run, each with a Copy button. */
  runs: string[]
  /** The session's working directory when the card arrived, for relative review paths. */
  root: string
  status: 'open' | 'done'
  createdAt: number
  /** True when the person clicked something Claude has not been told about yet. */
  isDirty: boolean
}

declare module 'claude-code' {
  interface PluginState {
    handoffs: {
      items: Handoff[]
      /** The number the next card takes. */
      seq: number
      /** Whether the done cards are listed in the pane. */
      showDone: boolean
      /** Blocks already turned into cards, by their text, so a block read twice makes one card. */
      seen: string[]
    }
  }
}
