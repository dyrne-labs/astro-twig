import { defineConfig } from 'astro/config';
import twig from 'astro-twig';

export default defineConfig({
  integrations: [
    twig({
      components: new URL('./src/components', import.meta.url),

      namespaces: {
        '@atoms': new URL('./src/atoms', import.meta.url),
      },

      functions: {
        shout: (value) => String(value).toUpperCase(),
      },

      filters: {
        exclaim: (value) => `${value}!`,
      },

      extensions: (Twig) => {
        Twig.extendFunction('viaExtension', () => 'extension-ran');
      },

      // Inverted from the default: an explicit prop beats a filled slot.
      slots: (props, slots) => ({ ...slots, ...props }),
    }),
  ],
});
