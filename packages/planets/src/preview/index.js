import { PREVIEW_PAGES } from './pages.js';

// The directory at /preview/ — rendered from the manifest rather than written
// out by hand, so it cannot list a page that no longer exists or miss one that
// was just added.
const directory = document.getElementById('directory');

for (const { href, title, description } of PREVIEW_PAGES) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = href;

  const heading = document.createElement('h2');
  heading.textContent = title;

  const blurb = document.createElement('p');
  blurb.textContent = description;

  link.append(heading, blurb);
  item.append(link);
  directory.append(item);
}
