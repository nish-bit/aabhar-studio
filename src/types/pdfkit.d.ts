// pdfkit ships no types. Only what src/server/pdf/pdfkit-standard-fonts.ts uses.
declare module "pdfkit" {
  export const registerStdFonts: ((...fonts: unknown[]) => void) | undefined;
}

declare module "pdfkit/standard-fonts/*" {
  const font: { name: string };
  export default font;
}
