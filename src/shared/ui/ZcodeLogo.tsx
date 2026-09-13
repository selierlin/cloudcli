// ZCode (Z.AI) provider logo. Sourced from the bundled ZCode.app icon
// (`/Applications/ZCode.app/Contents/Resources/icon.png`), downscaled and
// stored as `public/zcode.png`. The official mark is a dark rounded tile
// with a white "Z", so it renders the same in light and dark themes.

type ZcodeLogoProps = {
  className?: string;
};

const ZcodeLogo = ({ className = 'w-5 h-5' }: ZcodeLogoProps) => (
  <img
    src="/zcode.png"
    alt="ZCode"
    className={`${className} object-contain`}
  />
);

export default ZcodeLogo;