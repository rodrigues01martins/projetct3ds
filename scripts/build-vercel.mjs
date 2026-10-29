
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync
} from 'node:fs';

import { dirname, join } from 'node:path';

const outputDir = 'public';

const directories = [
  'editor',
  'build',
  'examples/jsm',
  'files'
];

// Remove arquivos de publicações anteriores
rmSync(outputDir, {
  recursive: true,
  force: true
});

// Copia apenas os recursos necessários
for (const source of directories) {
  if (!existsSync(source)) {
    throw new Error(`Diretório não encontrado: ${source}`);
  }

  const destination = join(outputDir, source);

  mkdirSync(dirname(destination), {
    recursive: true
  });

  cpSync(source, destination, {
    recursive: true
  });

  console.log(`Copiado: ${source}`);
}

console.log('Three.js Editor preparado para o Vercel.');
