// Iconos Phosphor (MIT) importados como SVG sueltos: solo se incluyen en la web los que se usan.
import altitude from '@phosphor-icons/core/assets/bold/mountains-bold.svg?raw';
import arrowDown from '@phosphor-icons/core/assets/bold/arrow-down-bold.svg?raw';
import arrowRight from '@phosphor-icons/core/assets/bold/arrow-right-bold.svg?raw';
import arrowUp from '@phosphor-icons/core/assets/bold/arrow-up-bold.svg?raw';
import camera from '@phosphor-icons/core/assets/bold/camera-rotate-bold.svg?raw';
import check from '@phosphor-icons/core/assets/bold/check-bold.svg?raw';
import confetti from '@phosphor-icons/core/assets/fill/confetti-fill.svg?raw';
import cookie from '@phosphor-icons/core/assets/bold/cookie-bold.svg?raw';
import close from '@phosphor-icons/core/assets/bold/x-bold.svg?raw';
import external from '@phosphor-icons/core/assets/bold/arrow-square-out-bold.svg?raw';
import gear from '@phosphor-icons/core/assets/bold/gear-six-bold.svg?raw';
import info from '@phosphor-icons/core/assets/bold/info-bold.svg?raw';
import legal from '@phosphor-icons/core/assets/bold/scales-bold.svg?raw';
import keyboard from '@phosphor-icons/core/assets/bold/keyboard-bold.svg?raw';
import loader from '@phosphor-icons/core/assets/bold/circle-notch-bold.svg?raw';
import nav from '@phosphor-icons/core/assets/fill/navigation-arrow-fill.svg?raw';
import path from '@phosphor-icons/core/assets/bold/path-bold.svg?raw';
import pin from '@phosphor-icons/core/assets/bold/map-pin-bold.svg?raw';
import question from '@phosphor-icons/core/assets/bold/question-bold.svg?raw';
import recent from '@phosphor-icons/core/assets/bold/clock-counter-clockwise-bold.svg?raw';
import reset from '@phosphor-icons/core/assets/bold/arrow-counter-clockwise-bold.svg?raw';
import ruler from '@phosphor-icons/core/assets/bold/ruler-bold.svg?raw';
import search from '@phosphor-icons/core/assets/bold/magnifying-glass-bold.svg?raw';
import share from '@phosphor-icons/core/assets/bold/share-network-bold.svg?raw';
import star from '@phosphor-icons/core/assets/fill/star-fill.svg?raw';
import stop from '@phosphor-icons/core/assets/fill/stop-fill.svg?raw';
import target from '@phosphor-icons/core/assets/bold/target-bold.svg?raw';
import timer from '@phosphor-icons/core/assets/bold/timer-bold.svg?raw';
import travel from '@phosphor-icons/core/assets/bold/airplane-in-flight-bold.svg?raw';
import ufo from '@phosphor-icons/core/assets/fill/flying-saucer-fill.svg?raw';
import warning from '@phosphor-icons/core/assets/bold/warning-circle-bold.svg?raw';

const ICONS = {
  altitude, arrowDown, arrowRight, arrowUp, camera, check, close, confetti, cookie, external, gear, info, keyboard, legal, loader,
  nav, path, pin, question, recent, reset, ruler, search, share, star, stop, target, timer, travel, ufo, warning,
};
export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
  return ICONS[name].replace('<svg ', '<svg class="icon" aria-hidden="true" focusable="false" ');
}

/** Rellena los `<span data-icon="nombre">` del HTML. */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon as IconName);
  });
}
