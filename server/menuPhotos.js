// Stand-in food photos for the menu, from Pexels (free to use, no credit needed:
// https://www.pexels.com/license/). They are there so the app looks real in demos; swap each one
// for the restaurant's own photo in the admin (Menu → item → Photo link) when it's ready.
// Moi Moi and Ponmo have no close match yet, so they keep their icon.

const PEXELS = [
  ["Amala", 633627],
  ["Plantain Amala", 37648019],
  ["Poundo", 37648014],
  ["Eba", 37648018],
  ["Egusi", 35490114],
  ["Okro", 20004804],
  ["Vegetable (Efo Riro)", 37648017],
  ["Jollof Rice", 17952745],
  ["Fried Rice", 32612771],
  ["Asun Rice", 18805640],
  ["Ofada Rice", 35374997],
  ["Ofada Sauce", 37081059],
  ["Chinese Rice", 19792090],
  ["Rice & Beans", 27556972],
  ["White Rice", 31346219],
  ["Oil Beans", 37121072],
  ["Spaghetti", 5807020],
  ["Dodo (Plantain)", 27556971],
  ["Salad", 13422414],
  ["Assorted", 34251051],
  ["Goatmeat", 34837746],
  ["Cowleg", 15131170],
  ["Big Turkey", 9760204],
  ["Medium Turkey", 9760204],
  ["Cow Head", 5531292],
  ["Chicken", 37324427],
  ["Meluza Fish", 15954348],
  ["Titus Fish", 33649028],
  ["Boiled Titus", 5041490],
  ["Dryfish", 30688175],
  ["Panla Fish", 27180320],
  ["Fried Beef", 17849432],
];

export const photoUrl = (id) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=320&h=320&fit=crop`;

// Menu item name → photo link.
export const MENU_PHOTOS = Object.fromEntries(PEXELS.map(([name, id]) => [name, photoUrl(id)]));
