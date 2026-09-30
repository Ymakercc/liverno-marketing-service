# KULON Marketing Console Design System

## Product character

KULON Marketing Console is an operational B2B workspace. It should feel calm,
precise, and trustworthy during repeated daily use. The interface prioritizes
customer data, approval decisions, and delivery state over decoration.

The system borrows data ergonomics from Airtable, navigation restraint from
Linear, enterprise semantics from IBM Carbon, and email workflow focus from
Superhuman. It does not reproduce any one reference product.

## Principles

1. Put the current task first. Every screen has one clear heading and one
   primary action.
2. Keep data dense but readable. Tables use compact rows, sticky headers, clear
   column alignment, and semantic status chips.
3. Treat AI as an assistant. AI output is visually separated from editable
   email content and always remains behind human approval.
4. Use surface contrast instead of decorative shadows. White work surfaces sit
   on a cool neutral canvas with hairline borders.
5. Make system state explicit. Connected, waiting, warning, and blocked states
   always use both color and text.

## Tokens

### Color

- Canvas: `#f4f6f5`
- Surface: `#ffffff`
- Surface subdued: `#f8faf9`
- Ink: `#17211d`
- Secondary ink: `#4f5d56`
- Muted ink: `#748079`
- Hairline: `#dfe5e1`
- Strong border: `#cbd4cf`
- KULON green: `#176b4d`
- KULON green active: `#0f533b`
- Green wash: `#e8f3ed`
- Information: `#326b91`
- Information wash: `#eaf2f7`
- Warning: `#a66a16`
- Warning wash: `#fbf2e3`
- Danger: `#a9423e`
- Danger wash: `#f9eae8`

Brand green identifies primary actions. Semantic green indicates ready or
approved state; warning and danger colors are never substituted with brand
green.

### Typography

- UI family: Inter, system UI, PingFang SC, Microsoft YaHei, sans-serif
- Page title: 26px / 34px / 700
- Section title: 16px / 24px / 700
- Body: 13px / 20px / 400
- Table body: 12px / 18px / 400
- Supporting text: 11px / 16px / 400
- Labels: 11px / 16px / 650
- Letter spacing is always `0`.

### Spacing and shape

- Base unit: 4px
- Common spacing: 4, 8, 12, 16, 20, 24, 32px
- Inputs and buttons: 36-40px high
- Compact table row: at least 52px high
- Small control radius: 4px
- Card and panel radius: 6px
- Drawer radius: 0px because it is attached to the viewport edge

## Layout

- Desktop sidebar: 232px fixed, full viewport height
- Top toolbar: 64px sticky
- Content width: up to 1480px, with responsive 24-36px gutters
- Work panels use borders and white surfaces; page sections themselves remain
  unframed
- Below 900px, navigation becomes a horizontal task bar and multi-column work
  areas stack
- Below 640px, filters become a horizontal scroll strip so the data table keeps
  stable column widths without compressing labels

## Components

### Navigation

Navigation is grouped into Work and System areas. The active item uses a light
green fill, dark green text, and a 3px left indicator. Counts are neutral badges.

### Buttons

- Primary: green fill, white text; one per action cluster
- Secondary: white fill, strong border
- Quiet: transparent, used for low-priority commands
- Icon controls: square and named with `title` and `aria-label`

### Data table

The customer table is the main working surface. Its header is sticky, sort
state has a persistent accent, company/contact cells use a two-line hierarchy,
and row hover is subtle. Horizontal scrolling is allowed when columns cannot be
represented faithfully.

### Status

Status chips have restrained rectangular shapes. Ready/eligible is green,
informational is blue, waiting is amber, blocked/error is red, and inactive is
gray. Text remains present in every state.

### Empty, loading, and error states

Loading uses low-contrast skeleton rows. Empty states state what is missing and
offer the most useful next action. Toasts are reserved for short feedback and
never replace persistent error content.

## Guardrails

- No oversized hero typography, gradients, floating decorative cards, or
  nested card stacks.
- No viewport-scaled type.
- No keys or secret values in the interface.
- No automatic sending without explicit approval.
- No color-only state communication.
- All interactive controls need visible focus treatment and at least a 36px
  target on desktop, 40px on touch layouts.
