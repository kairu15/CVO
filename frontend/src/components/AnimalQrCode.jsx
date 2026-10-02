import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * Renders a QR code for an animal's tag payload.
 *
 * Generation is local (qrcode-generator, no network, no external image API),
 * so it works on a warehouse PC with no internet just as well as online. The
 * data URL is a small image the browser can print directly.
 *
 * @param {object} props
 * @param {string} props.value   the payload to encode (see lib/animalQr.js)
 * @param {number} [props.cellSize] pixels per QR module
 * @param {number} [props.margin]   quiet-zone modules
 * @param {string} [props.className]
 * @param {string} [props.alt]
 */
export function AnimalQrCode({ value, cellSize = 8, margin = 4, className, alt }) {
  const src = useMemo(() => {
    if (!value) return null;

    // typeNumber 0 = pick the smallest version that fits; "M" is a standard
    // error-correction level that tolerates a laminated tag getting scuffed.
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();

    return qr.createDataURL(cellSize, margin);
  }, [value, cellSize, margin]);

  if (!src) return null;

  return <img src={src} alt={alt ?? `QR code for ${value}`} className={className} />;
}
