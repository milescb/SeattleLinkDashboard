// Reads the palette from css/theme.css so the map and charts share one source of truth.
const rootStyle = getComputedStyle(document.documentElement);
const color = name => rootStyle.getPropertyValue(`--${name}`).trim();
const routeColor = (id, gtfsColor) => color(`route-${id}`) || gtfsColor || color('route-all');
