// Catering page content. Edit here (or tell Claude) to change packages and prices.
// price: a number per guest (e.g. 18) or null to show "Custom quote".

export const packages = [
  {
    name: "The Drop-Off",
    blurb: "Biscuit sandwich trays delivered and set up, ready to serve.",
    price: null,
    items: ["Biscuit sandwich trays", "Sides", "Serving ware + napkins", "Delivery + setup in Tampa Bay"],
    tone: "light",
  },
  {
    name: "The Biscuit Bar",
    blurb: "A build-your-own biscuit bar your guests will talk about.",
    price: null,
    items: ["Biscuit varieties", "Toppings + spreads", "Sides", "Buffet setup + attendant"],
    tone: "butter",
  },
  {
    name: "The Full Lab",
    blurb: "Our crew on-site, cooking and serving biscuits hot.",
    price: null,
    items: ["On-site cooking", "Full service staff", "Custom menu built with you", "Service hours to fit your event"],
    tone: "dark",
  },
];

// Add-ons: { name: "Coffee service", price: "$4 / guest" }. Leave empty to hide the section.
export const addOns = [];
