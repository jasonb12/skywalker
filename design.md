# Skywalker - Minneapolis Skyway Navigator - Design Document

## Overview
A mobile navigation app for the Minneapolis Skyway System. The app provides an interactive map with live user position, business search, turn-by-turn directions with haptic feedback, and path history. Designed for one-handed portrait use following Apple HIG.

## Color Palette
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| primary | #0066CC | #4DA6FF | Navigation accents, active route, buttons |
| background | #FFFFFF | #121416 | Screen backgrounds |
| surface | #F2F4F6 | #1C1F22 | Cards, bottom sheets, search bar |
| foreground | #1A1A1A | #F0F0F0 | Primary text |
| muted | #6B7280 | #9CA3AF | Secondary text, labels |
| border | #E2E5E9 | #2D3238 | Dividers, card borders |
| success | #10B981 | #34D399 | On-route indicator, open status |
| warning | #F59E0B | #FBBF24 | Off-course alert |
| error | #EF4444 | #F87171 | Closed status, error states |
| skyway | #0066CC | #4DA6FF | Skyway route lines on map |
| building | #8B5CF6 | #A78BFA | Building markers on map |

## Screen List

### 1. Map Screen (Home / Default Tab)
- **Primary content**: Full-screen interactive map centered on downtown Minneapolis skyway grid
- **Map elements**: Skyway route lines (blue polylines), building markers (purple dots), business POI pins, live user position dot (pulsing blue circle)
- **Top overlay**: Search bar with magnifying glass icon, tappable to open search
- **Bottom sheet (collapsed)**: Shows "Skywalker" branding + current building name if inside skyway
- **Bottom sheet (expanded on search/select)**: Business detail card or route summary
- **Map controls**: Re-center button (bottom-right above tab bar), zoom +/- buttons

### 2. Search Screen (Tab or Modal from Map)
- **Primary content**: Search input at top, category filter chips below (Food, Coffee, Retail, Services, Hotels, etc.)
- **Results list**: FlatList of business cards showing name, category icon, building name, distance, open/closed status
- **Each card**: Tappable → navigates to map centered on that business with route option
- **Recent searches**: Shown when search field is empty

### 3. Navigate Screen (Overlay on Map)
- **Activated when**: User selects "Directions" to a business or building
- **Top bar**: Destination name, estimated walk time, distance
- **Map view**: Route highlighted in bold blue, upcoming turn indicated with arrow
- **Turn instruction banner**: Large text "Turn left at Gaviidae Common" with arrow icon
- **Bottom controls**: "End Navigation" button, step list toggle
- **Step list (expandable)**: Ordered list of all turns with distance between each

### 4. History Screen (Tab)
- **Primary content**: FlatList of previous navigation sessions
- **Each item**: Date/time, start → destination, total distance, duration
- **Tappable**: Opens map view of that historical route
- **Empty state**: "No navigation history yet" with illustration

### 5. Settings Screen (Tab)
- **Sections**: Haptic Feedback toggle, Distance Units (feet/meters), Map Style (standard/satellite), About/Version
- **Simple list layout** with section headers

## Key User Flows

### Flow 1: Find a Business
1. User opens app → Map screen with current position dot
2. Taps search bar → Search screen appears
3. Types "coffee" → Filtered results show coffee shops
4. Taps "Caribou Coffee - IDS" → Map centers on that location with pin
5. Taps "Directions" button → Navigation starts

### Flow 2: Turn-by-Turn Navigation
1. From business detail, user taps "Get Directions"
2. Route calculated via A* on skyway graph
3. Map shows highlighted route from current position to destination
4. Turn instruction banner shows first instruction
5. As user walks, position dot moves along route
6. Approaching a turn → haptic buzz (medium impact) + banner updates
7. User goes off-course → haptic warning (error notification) + "Recalculating..."
8. Arrives at destination → haptic success + "You have arrived" banner

### Flow 3: View Path History
1. User taps History tab
2. Sees list of past navigations with dates
3. Taps one → Map shows that historical route in a different color
4. Can see start/end points and route taken

## Navigation Structure
- **Bottom Tab Bar** with 4 tabs:
  1. Map (house.fill icon) - Home/default
  2. Search (magnifyingglass icon)
  3. History (clock.fill icon)
  4. Settings (gearshape.fill icon)

## Component Patterns
- **ScreenContainer** wraps every screen for safe area
- **MapView** uses react-native-maps with custom tile overlay for skyway
- **Business cards** use surface background with border, category icon left, chevron right
- **Navigation banner** fixed at top of map during active navigation, high contrast
- **Haptic feedback** on: button taps (light), turn approaching (medium), off-course (error notification), arrival (success notification)
