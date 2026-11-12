/**
 * Arknights x Neubrutalism design tokens.
 *
 * Light is blueprint paper; dark is the Rhodes Island terminal. Every value is
 * a plain CSS custom property so the host can swap the theme at runtime by
 * mounting or unmounting a single <style> element.
 */
export const tokensCss = `
:root {
  color-scheme: light;

  /* Paper, measured from in-game card bodies. */
  --background: oklch(0.962 0.004 95);
  --foreground: oklch(0.2221 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.2221 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.2221 0 0);

  /* Primary plate = graphite #313131, the game's load-bearing surface. */
  --primary: oklch(0.3132 0 0);
  --primary-foreground: oklch(0.985 0.002 95);
  --secondary: oklch(0.935 0.003 95);
  --secondary-foreground: oklch(0.28 0 0);
  --muted: oklch(0.935 0.003 95);
  --muted-foreground: oklch(0.4604 0 0);
  --accent: oklch(0.92 0.012 230);
  --accent-foreground: oklch(0.24 0.01 240);
  --destructive: oklch(0.4513 0.1852 29.23);
  --border: oklch(0.78 0 0);
  --input: oklch(0.78 0 0);
  --ring: oklch(0.5334 0.1174 237.54);

  /* Signal: deep-blue action #0075a8. */
  --brand: oklch(0.5334 0.1174 237.54);
  --brand-foreground: oklch(0.99 0 0);
  --hazard: oklch(0.6867 0.2083 39.46);

  /* Structural ink. Dark mode lightens it so edges survive black shadows. */
  --edge: oklch(0.2221 0 0);
  --shadow-color: oklch(0.2221 0 0);

  --chart-1: oklch(0.5334 0.1174 237.54);
  --chart-2: oklch(0.7105 0.1291 240.6);
  --chart-3: oklch(0.8689 0.1526 111.23);
  --chart-4: oklch(0.8421 0.1496 90);
  --chart-5: oklch(0.4513 0.1852 29.23);

  /* Zero radius everywhere: rounding scales derive from this one value. */
  --radius: 0rem;

  --sidebar: oklch(0.935 0.003 95);
  --sidebar-foreground: oklch(0.28 0 0);
  --sidebar-primary: oklch(0.3132 0 0);
  --sidebar-primary-foreground: oklch(0.985 0.002 95);
  --sidebar-accent: oklch(0.89 0.014 235);
  --sidebar-accent-foreground: oklch(0.2221 0 0);
  --sidebar-border: oklch(0.2221 0 0 / 20%);
  --sidebar-ring: oklch(0.5334 0.1174 237.54);

  /* Course fills stay near-paper; the hue lives in the rail. */
  --schedule-1: oklch(0.945 0.035 155);
  --schedule-2: oklch(0.945 0.03 210);
  --schedule-3: oklch(0.95 0.05 95);
  --schedule-4: oklch(0.95 0.04 65);
  --schedule-5: oklch(0.948 0.035 20);
  --schedule-6: oklch(0.948 0.035 320);
  --schedule-7: oklch(0.945 0.035 275);
  --schedule-8: oklch(0.945 0.035 245);
  --schedule-ink-1: oklch(0.5 0.12 155);
  --schedule-ink-2: oklch(0.5 0.11 210);
  --schedule-ink-3: oklch(0.55 0.13 85);
  --schedule-ink-4: oklch(0.55 0.14 55);
  --schedule-ink-5: oklch(0.52 0.17 25);
  --schedule-ink-6: oklch(0.5 0.16 330);
  --schedule-ink-7: oklch(0.46 0.14 275);
  --schedule-ink-8: oklch(0.48 0.13 245);

  /* Rarity ramp measured from in-game item frames. */
  --rarity-1: oklch(0.65 0 0);
  --rarity-2: oklch(0.82 0.16 118);
  --rarity-3: oklch(0.66 0.13 240);
  --rarity-4: oklch(0.75 0.09 330);
  --rarity-5: oklch(0.82 0.15 85);

  /* Hard, zero-blur depth. */
  --shadow-2xs: 1px 1px 0 0 var(--shadow-color);
  --shadow-xs: 2px 2px 0 0 var(--shadow-color);
  --shadow-sm: 2px 2px 0 0 var(--shadow-color);
  --shadow-md: 3px 3px 0 0 var(--shadow-color);
  --shadow-lg: 5px 5px 0 0 var(--shadow-color);
  --shadow-xl: 7px 7px 0 0 var(--shadow-color);
  --shadow-2xl: 10px 10px 0 0 var(--shadow-color);
}

:root.dark,
.dark {
  color-scheme: dark;

  /* Canvas #111315, wells #1b1b1b, graphite #313131. */
  --background: oklch(0.155 0.006 240);
  --foreground: oklch(0.925 0.002 220);
  --card: oklch(0.2221 0 0);
  --card-foreground: oklch(0.925 0.002 220);
  --popover: oklch(0.2554 0 0);
  --popover-foreground: oklch(0.925 0.002 220);

  --primary: oklch(0.925 0.002 220);
  --primary-foreground: oklch(0.185 0 0);
  --secondary: oklch(0.3132 0 0);
  --secondary-foreground: oklch(0.925 0.002 220);
  --muted: oklch(0.285 0 0);
  --muted-foreground: oklch(0.7515 0 0);
  --accent: oklch(0.33 0.008 235);
  --accent-foreground: oklch(0.955 0.002 220);
  --destructive: oklch(0.62 0.19 27);
  --border: oklch(0.55 0 0);
  --input: oklch(0.5 0 0);
  --ring: oklch(0.7985 0.1444 221.77);

  /* Info cyan #18d1ff. */
  --brand: oklch(0.7985 0.1444 221.77);
  --brand-foreground: oklch(0.19 0.02 230);
  --hazard: oklch(0.78 0.17 55);

  /* Black shadows vanish on black; a pale translucent edge carries structure. */
  --edge: oklch(0.86 0 0 / 30%);
  --shadow-color: oklch(0.05 0 0);

  --chart-1: oklch(0.7985 0.1444 221.77);
  --chart-2: oklch(0.7105 0.1291 240.6);
  --chart-3: oklch(0.8689 0.1526 111.23);
  --chart-4: oklch(0.8421 0.1496 90);
  --chart-5: oklch(0.62 0.19 27);

  --radius: 0rem;

  --sidebar: oklch(0.185 0.002 240);
  --sidebar-foreground: oklch(0.9 0.002 220);
  --sidebar-primary: oklch(0.7985 0.1444 221.77);
  --sidebar-primary-foreground: oklch(0.19 0.02 230);
  --sidebar-accent: oklch(0.285 0.006 235);
  --sidebar-accent-foreground: oklch(0.955 0.002 220);
  --sidebar-border: oklch(0.86 0 0 / 18%);
  --sidebar-ring: oklch(0.7985 0.1444 221.77);

  --schedule-1: oklch(0.28 0.04 155);
  --schedule-2: oklch(0.28 0.035 210);
  --schedule-3: oklch(0.29 0.045 95);
  --schedule-4: oklch(0.29 0.04 65);
  --schedule-5: oklch(0.29 0.04 20);
  --schedule-6: oklch(0.29 0.04 320);
  --schedule-7: oklch(0.28 0.04 275);
  --schedule-8: oklch(0.28 0.04 245);
  --schedule-ink-1: oklch(0.78 0.15 155);
  --schedule-ink-2: oklch(0.79 0.12 210);
  --schedule-ink-3: oklch(0.85 0.15 90);
  --schedule-ink-4: oklch(0.8 0.15 60);
  --schedule-ink-5: oklch(0.72 0.17 25);
  --schedule-ink-6: oklch(0.78 0.15 330);
  --schedule-ink-7: oklch(0.74 0.14 275);
  --schedule-ink-8: oklch(0.78 0.13 245);

  --rarity-1: oklch(0.72 0 0);
  --rarity-2: oklch(0.86 0.16 118);
  --rarity-3: oklch(0.74 0.14 240);
  --rarity-4: oklch(0.82 0.1 330);
  --rarity-5: oklch(0.86 0.16 85);
}
`
