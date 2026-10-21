/**
 * Character voxel models. This module is code-split and lazy-loaded: the main
 * bundle only carries roster metadata. Models are assembled from a body
 * template plus accessory parts, all original designs. Models face +z and are
 * authored in tenth-of-a-tile units.
 */
import type * as THREE from 'three';
import type { PaletteAtlas } from '../render/atlas';
import { VoxelBuilder } from '../render/voxel';
import type { CharacterDef, Template } from './characters';

export interface CharacterModel {
  geometry: THREE.BufferGeometry;
  /** Colours used by the model, for themed particle bursts. */
  colors: string[];
  height: number;
}

interface Anchor {
  top: number;
  front: number;
  eyeY: number;
  eyeX: number;
  headZ: number;
  headW: number;
  back: number;
}

const ANCHORS: Record<Template, Anchor> = {
  blob: { top: 7.5, front: 3.5, eyeY: 4.6, eyeX: 1.6, headZ: 0, headW: 7, back: -3.5 },
  quad: { top: 8.8, front: 5.9, eyeY: 7, eyeX: 1.5, headZ: 3.7, headW: 5.6, back: -4.2 },
  bird: { top: 7.5, front: 3, eyeY: 5.2, eyeX: 1.5, headZ: 0, headW: 6, back: -3 },
  biped: { top: 10.6, front: 2.3, eyeY: 8.3, eyeX: 1.2, headZ: 0, headW: 5, back: -2.3 },
  bot: { top: 10, front: 2.2, eyeY: 7.9, eyeX: 1.2, headZ: 0, headW: 5, back: -2.5 },
  bug: { top: 5, front: 4.75, eyeY: 3.3, eyeX: 1, headZ: 3.5, headW: 4, back: -4 },
  box: { top: 7, front: 2.5, eyeY: 5, eyeX: 1.5, headZ: 0, headW: 6.5, back: -2.5 },
  fish: { top: 7, front: 4, eyeY: 5, eyeX: 1.4, headZ: 2, headW: 5, back: -4 },
  plant: { top: 8.5, front: 1.8, eyeY: 6.6, eyeX: 0.9, headZ: 0, headW: 3.6, back: -1.8 },
};

const WHITE = '#ffffff';
const BLACK = '#15151b';

export function buildCharacterModel(def: CharacterDef, atlas: PaletteAtlas): CharacterModel {
  const b = new VoxelBuilder(atlas);
  const [main, second, accent, detail] = def.colors;
  const a = ANCHORS[def.template];
  const has = (p: string) => def.parts.includes(p);

  // ------------------------------------------------------------ body template
  switch (def.template) {
    case 'blob':
      b.cbox(0, 1, 0, 7, 5.5, 7, main);
      b.cbox(0, 6.5, 0, 5.4, 1, 5.4, main);
      b.cbox(0, 1.5, 3.2, 4.6, 3, 0.8, second);
      b.pair(1.8, 0, 0.6, 2, 1, 2.6, accent);
      break;
    case 'quad':
      b.pair(2, 0, 2.4, 1.6, 2.2, 1.6, second);
      b.pair(2, 0, -2.6, 1.6, 2.2, 1.6, second);
      b.cbox(0, 2, -0.6, 6, 3.8, 7.2, main);
      b.cbox(0, 4.2, 3.7, 5.6, 4.6, 4.4, main);
      b.cbox(0, 4.6, 6.2, 3, 1.8, 1, accent);
      b.cbox(0, 5.8, 6.6, 1.1, 0.8, 0.4, detail);
      break;
    case 'bird':
      b.cbox(0, 1.5, 0, 6, 6, 6, main);
      b.cbox(0, 2, 2.6, 4.4, 3, 0.8, second);
      b.pair(1.3, 0, 0.4, 0.8, 1.6, 0.8, accent);
      b.pair(1.3, 0, 1, 1.4, 0.4, 1.6, accent);
      b.pair(3.3, 2.6, -0.4, 0.8, 3, 4, second);
      if (!has('beakBig')) b.cbox(0, 3.8, 3.4, 1.6, 1.2, 1.2, accent);
      break;
    case 'biped':
      b.pair(1.3, 0, 0, 1.8, 2.6, 2, second);
      b.cbox(0, 2.6, 0, 5.4, 3.6, 3.6, main);
      b.pair(3.3, 3, 0, 1.2, 3, 1.4, main);
      b.cbox(0, 6.2, 0, 5, 4.4, 4.6, has('hatWizard') ? detail : main);
      break;
    case 'bot':
      b.pair(1.5, 0, 0, 1.6, 2.2, 1.6, detail);
      b.cbox(0, 2.2, 0, 6, 4, 5, main);
      b.cbox(0, 3, 2.5, 3, 2, 0.4, accent);
      b.pair(3.4, 3, 0, 1, 2.6, 1.4, second);
      b.cbox(0, 6.2, 0, 5, 3.8, 4.4, second);
      if (!has('visor') && !has('pixelFace')) b.cbox(0, 6.8, 2.2, 4, 2.6, 0.3, detail);
      break;
    case 'bug':
      b.cbox(0, 1, -0.5, 6, 4, 7, main);
      b.cbox(0, 1.6, 3.5, 4, 3, 2.5, detail);
      for (const z of [-2.4, 0, 2.4]) b.pair(3.2, 0, z, 1, 1.6, 0.8, detail);
      b.cbox(0, 5, -0.5, 0.5, 0.3, 7, detail);
      break;
    case 'box':
      b.cbox(0, 1, 0, 6.5, 6, 5, main);
      b.pair(2, 0, 0, 1.6, 1, 2.2, detail);
      b.pair(3.5, 3, 0, 0.6, 1.6, 1.6, second);
      break;
    case 'fish':
      b.cbox(0, 2, 0, 5, 5, 8, main);
      b.cbox(0, 2.4, -5, 0.8, 4.2, 2.2, accent);
      b.pair(1.3, 0, 0.5, 1, 2, 1, accent);
      b.cbox(0, 2.2, 2.5, 4, 0.8, 3, second);
      break;
    case 'plant':
      b.cbox(0, 0, 0, 5, 3.4, 5, accent);
      b.cbox(0, 3.4, 0, 5.8, 1, 5.8, detail);
      b.cbox(0, 4.4, 0, 3.6, 4, 3.6, main);
      break;
  }

  // ------------------------------------------------------------ face
  const noEyes = has('visor') || has('pixelFace') || has('spaceHelmet');
  if (!noEyes) {
    const s = has('bigEyes') ? 1.8 : 1.2;
    b.pair(a.eyeX + (has('bigEyes') ? 0.3 : 0), a.eyeY, a.front + 0.1, s, s, 0.4, WHITE);
    if (has('eyepatch')) {
      b.cbox(a.eyeX, a.eyeY + 0.3, a.front + 0.4, 0.7, 0.7, 0.4, BLACK);
      b.cbox(-a.eyeX, a.eyeY - 0.1, a.front + 0.3, s + 0.4, s + 0.4, 0.4, BLACK);
      b.cbox(0, a.eyeY + s, a.front + 0.3, a.headW, 0.3, 0.3, BLACK);
    } else {
      b.pair(a.eyeX + (has('bigEyes') ? 0.3 : 0), a.eyeY + 0.2, a.front + 0.4, s / 2, s / 2, 0.3, BLACK);
    }
  }

  // ------------------------------------------------------------ accessories
  const top = a.top;
  const hz = a.headZ;
  for (const p of def.parts) {
    switch (p) {
      case 'leaf':
        b.cbox(0, top - 0.5, hz, 0.6, 2, 0.6, '#3d8a25');
        b.cbox(1.2, top + 1.2, hz, 2.6, 0.6, 1.6, accent === '#3d8a25' ? second : '#5fb83a');
        break;
      case 'ears':
        b.pair(2.6, top - 2.5, hz, 1, 3, 2, second);
        break;
      case 'earsPointy':
        b.pair(1.8, top, hz - 0.4, 1.4, 1.6, 1, main);
        b.pair(1.8, top + 1.6, hz - 0.4, 0.8, 0.8, 0.8, main);
        break;
      case 'earsBig':
        b.pair(2, top, hz - 0.5, 2, 3.2, 0.8, main);
        b.pair(2, top + 0.4, hz - 0.1, 1.2, 2.4, 0.4, accent);
        break;
      case 'earTufts':
        b.pair(2.2, top, 0, 1.2, 1.6, 1.2, second);
        break;
      case 'tail':
        b.cbox(0, 4, a.back - 1, 1, 1, 2, second);
        break;
      case 'tailLong':
        b.cbox(0, 3.6, a.back - 1.6, 1, 1, 3, main);
        b.cbox(0, 3.6, a.back - 3.1, 1, 2.4, 1, main);
        break;
      case 'tailBushy':
        b.cbox(0, 3, a.back - 1.8, 2.6, 2.6, 3.6, main);
        b.cbox(0, 3.4, a.back - 3.8, 2, 2, 0.6, accent);
        break;
      case 'stripes':
        for (let i = 0; i < 3; i++) b.cbox(0, 2.5 + i * 1.4, a.back + 1 + i * 0.2, a.headW + 0.2, 0.5, 2.6, detail);
        break;
      case 'spots':
        b.pair(2.1, 3.5, -1.5, 2, 0.4, 1.4, accent);
        b.cbox(0, 5.85, -2, 1.6, 0.3, 1.6, accent);
        break;
      case 'spikes':
        for (let z = -3.5; z <= 2; z += 1.8) {
          for (let x = -2.4; x <= 2.4; x += 1.6) b.cbox(x, 5.6, z, 1, 1.6, 1, second);
        }
        break;
      case 'shell':
        b.cbox(0, 5.4, -0.8, 6.6, 2, 6.4, second);
        b.cbox(0, 7.4, -0.8, 4, 0.8, 4, accent);
        break;
      case 'beak':
        b.cbox(0, 3.6, 3.8, 1.8, 0.6, 1.2, accent);
        break;
      case 'beakBig':
        b.cbox(0, 3.4, 3.2, 2.2, 2.2, 2, accent);
        b.cbox(0, 3.4, 4.2, 2.2, 0.6, 0.6, detail);
        break;
      case 'hat':
        b.cbox(0, top, 0, 7, 0.6, 7, detail);
        b.cbox(0, top + 0.6, -0.2, 4.4, 1.6, 4.4, detail);
        break;
      case 'antenna':
        b.cbox(0, top, 0, 0.5, 2.4, 0.5, '#555c66');
        b.cbox(0, top + 2.4, 0, 1.2, 1.2, 1.2, accent);
        break;
      case 'antennae':
        b.pair(1, top - 0.4, hz + 1, 0.4, 2.2, 0.4, detail);
        b.pair(1.4, top + 1.6, hz + 1.4, 0.8, 0.8, 0.8, accent);
        break;
      case 'toast':
        b.cbox(-1.4, 6.4, 0, 2, 2.4, 3.6, accent);
        b.cbox(1.4, 6.8, 0, 2, 2, 3.6, accent);
        b.cbox(0, 3, 2.6, 4, 0.6, 0.3, detail);
        break;
      case 'shine':
        b.cbox(-2, 5, 3.2, 1, 1, 0.6, WHITE);
        break;
      case 'fronds':
        b.cbox(0, 8.4, 0, 1, 2, 1, main);
        b.pair(2, 7.6, 0, 2.6, 0.8, 1.4, second);
        b.cbox(0, 7.6, 2, 1.4, 0.8, 2.6, second);
        b.cbox(0, 7.6, -2, 1.4, 0.8, 2.6, second);
        b.cbox(0, 10.2, 0, 2, 0.8, 2, second);
        break;
      case 'pot':
        break;
      case 'cactusArms':
        b.pair(2.6, 5.8, 0, 1.6, 1.2, 1.2, main);
        b.pair(3.1, 6.6, 0, 1.2, 2.2, 1.2, main);
        break;
      case 'flower':
        b.cbox(0, top, 0, 2.2, 1, 2.2, accent);
        b.cbox(0, top + 1, 0, 1, 0.6, 1, '#ffe066');
        break;
      case 'shellShine':
        b.cbox(-1.2, 5, -1, 1.2, 0.4, 3, accent);
        break;
      case 'wings':
        b.pair(2.4, 5, -1.2, 3.4, 0.4, 3, accent);
        break;
      case 'wingsBat':
        b.pair(4, 3.4, -0.6, 2, 3.6, 3, second);
        b.pair(5.4, 4.6, -0.6, 1.2, 3, 2, second);
        break;
      case 'wingsMoth':
        b.pair(3.6, 4.6, -1, 3.6, 0.4, 4, second);
        b.pair(4.2, 5, -1, 1.6, 0.3, 1.6, accent);
        break;
      case 'fur':
        b.cbox(0, top - 1, 0, a.headW + 0.6, 1.4, 4, main);
        b.pair(a.headW / 2, 3, 0, 0.8, 4, 3.2, main);
        break;
      case 'horns':
        b.pair(2.2, top - 1, hz, 1, 1, 1, accent);
        b.pair(2.8, top, hz, 0.8, 1.6, 0.8, accent);
        break;
      case 'horn':
        b.cbox(0, 4.6, 4.8, 1, 2.2, 1, detail);
        break;
      case 'antlers':
        b.pair(1.8, top, hz - 0.5, 0.8, 2.2, 0.8, accent);
        b.pair(2.6, top + 1.6, hz - 0.5, 2, 0.8, 0.8, accent);
        b.pair(3.2, top + 2.4, hz - 0.5, 0.8, 1.2, 0.8, accent);
        break;
      case 'scales':
        for (let y = 2; y < 7; y += 1.6) b.cbox(0, y, 0, 7.4, 0.6, 7.4, second);
        break;
      case 'visor':
        b.cbox(0, 7.2, 2.2, 4.4, 1.6, 0.4, accent);
        b.cbox(0, 7.6, 2.4, 3, 0.6, 0.3, second);
        break;
      case 'pixelFace':
        b.cbox(0, 6.8, 2.2, 4, 2.6, 0.3, detail);
        b.pair(1, 8, 2.4, 0.8, 0.8, 0.3, main);
        b.cbox(0, 7, 2.4, 2, 0.5, 0.3, main);
        break;
      case 'glasses':
        b.pair(a.eyeX, a.eyeY - 0.1, a.front + 0.5, 1.8, 1.4, 0.3, accent);
        b.cbox(0, a.eyeY + 0.5, a.front + 0.5, 1.2, 0.4, 0.3, accent);
        break;
      case 'checker':
        for (let i = 0; i < 6; i++) b.cbox(-2.75 + i * 1.1, 3.4, 2.55, 1.1, 0.9, 0.2, i % 2 ? second : accent);
        break;
      case 'roofSign':
        b.cbox(0, 7, 0, 3, 1.4, 1.2, accent);
        b.cbox(0, 7.2, 0.62, 2.4, 1, 0.1, detail);
        break;
      case 'canTop':
        b.cbox(0, 7, 0, 5.6, 0.6, 4.2, second);
        b.cbox(1, 7.6, 0, 1.6, 0.3, 0.8, second);
        b.cbox(0, 2, 2.55, 6.6, 1.2, 0.2, accent);
        break;
      case 'sprinkles':
        b.cbox(-2, 6, 1, 1, 0.4, 0.4, accent).cbox(1.5, 6.3, -1, 0.4, 0.4, 1, '#7ad3ff');
        b.cbox(0.5, 7.5, 1.5, 1, 0.4, 0.4, '#ffd84a').cbox(-1, 7.5, -1.5, 0.4, 0.4, 1, accent);
        break;
      case 'bow':
        b.pair(1.2, top, 0, 1.6, 1.4, 1, accent);
        b.cbox(0, top + 0.2, 0, 0.8, 1, 1.1, detail);
        break;
      case 'fins':
        b.cbox(0, 7, -0.5, 0.8, 1.8, 4, accent);
        b.pair(2.8, 3, 1, 1, 1.4, 2, accent);
        break;
      case 'helmet':
        b.cbox(0, 6, 0, 5.6, 5, 5.2, main);
        b.cbox(0, 7.8, 2.65, 4, 0.8, 0.2, BLACK);
        b.cbox(0, 6, 0, 5.8, 0.8, 5.4, second);
        break;
      case 'plume':
        b.cbox(0, top + 0.4, -0.5, 1, 2.2, 3.6, accent);
        break;
      case 'spaceHelmet':
        b.cbox(0, 6, 0, 6, 5.2, 5.6, main);
        b.cbox(0, 6.8, 2.6, 4.6, 3.4, 0.6, detail);
        b.cbox(-1.2, 8.6, 2.95, 1, 0.8, 0.3, WHITE);
        break;
      case 'pack':
        b.cbox(0, 2.6, -2.6, 4, 4.4, 1.6, second);
        b.pair(1, 3, -3.4, 1, 1, 0.4, accent);
        break;
      case 'bandana':
        b.cbox(0, top - 1.4, 0, 5.4, 1.4, 5, accent);
        b.cbox(1.6, top - 2.4, -2.6, 1, 1.6, 0.6, accent);
        break;
      case 'eyepatch':
        break;
      case 'hatWizard':
        b.cbox(0, top, 0, 7, 0.6, 7, main);
        b.cbox(0, top + 0.6, 0, 4.4, 2, 4.4, main);
        b.cbox(0.4, top + 2.6, -0.2, 3, 2, 3, main);
        b.cbox(0.8, top + 4.6, -0.4, 1.6, 1.6, 1.6, main);
        b.cbox(0, top + 1, 0, 4.6, 0.6, 4.6, accent);
        break;
      case 'beard':
        b.cbox(0, 5, 2.3, 4, 2.6, 1, '#f4f4f4');
        b.cbox(0, 4.2, 2.5, 2.4, 1, 0.8, '#f4f4f4');
        break;
      case 'mane':
        for (let i = 0; i < 5; i++) {
          const col = ['#ff5fa2', '#ffb347', '#ffe066', '#7ee8a5', '#7ad3ff'][i];
          b.cbox(0, 6 + (i % 2) * 0.4, 1.6 - i * 1.4, 1.4, 1.4 + (i === 0 ? 1.4 : 0), 1.4, col);
        }
        break;
      case 'ghostTail':
        b.cbox(0, 0, -1, 5, 1, 3, main);
        b.cbox(0, 0, -3.2, 3, 0.8, 1.6, second);
        break;
      case 'flame':
        b.cbox(0, top, 0, 1.6, 1.6, 1.6, accent);
        b.cbox(0, top + 1.6, 0, 0.8, 1, 0.8, '#ff9f1c');
        break;
      case 'crown':
        b.cbox(0, top + 2, 0, 4, 1, 4, '#fff1a8');
        for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) b.cbox(x, top + 3, z, 0.8, 1, 0.8, '#fff1a8');
        b.cbox(0, top + 2.4, 2.05, 0.8, 0.6, 0.1, '#ff4b6e');
        break;
      case 'bigEyes':
        break;
      default:
        break;
    }
  }
  const geometry = b.build(0.1);
  const height = geometry.boundingBox ? geometry.boundingBox.max.y : 0.8;
  return { geometry, colors: b.colors.length ? b.colors : [main], height };
}
