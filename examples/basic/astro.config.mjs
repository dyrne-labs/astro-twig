import { defineConfig } from 'astro/config';
import twig from 'astro-twig';

export default defineConfig({
  integrations: [
    twig({
      components: new URL('./src/components', import.meta.url),
    }),
  ],
});
