import { useEffect, useState } from "react";
import logos from "@/data/filmCassetteLogos.json";
import labels from "@/data/filmCassetteLabels.json";
import { withBasePath } from "@/lib/basePath";
import styles from "@/styles/filmResultSpine.module.css";

const spineAsset = (name: string) =>
  withBasePath(`/VHS/program/result-spine/${name}.webp?v=2`);

/** The original VHS spine, with the same film artwork as the cassette label. */
export function FilmResultSpine({
  film,
  compact = false,
  eager = false,
}: {
  film: { title: string; year: number; coverImage: string };
  compact?: boolean;
  eager?: boolean;
}) {
  const logo = logos[film.coverImage as keyof typeof logos];
  const backdrop = labels[film.coverImage as keyof typeof labels];
  const [failedLogo, setFailedLogo] = useState<string>();
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [maskReady, setMaskReady] = useState(false);
  useEffect(() => {
    const mask = new Image();
    mask.onload = () => setMaskReady(true);
    mask.src = spineAsset("mask");
    return () => {
      mask.onload = null;
    };
  }, []);
  const image = [backdrop, film.coverImage].find(
    (candidate) => candidate && !failedImages.includes(candidate),
  );
  const hasLogo = logo && failedLogo !== logo.image;

  return (
    <span
      className={styles.spine}
      data-compact={compact}
      role="img"
      aria-label={`${film.title}${film.year ? ` (${film.year})` : ""}`}
      // A missing CSS mask makes the entire spine transparent, including its title.
      style={
        maskReady ? { maskImage: `url("${spineAsset("mask")}")` } : undefined
      }
    >
      <span aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.case}
          src={spineAsset("case")}
          alt=""
          draggable={false}
        />
        <span className={styles.print} data-surface={logo?.surface}>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.backdrop}
              src={withBasePath(image)}
              alt=""
              draggable={false}
              loading={compact || eager ? "eager" : "lazy"}
              onError={() =>
                setFailedImages((failed) =>
                  failed.includes(image) ? failed : [...failed, image],
                )
              }
            />
          )}
          <span className={styles.shade} />
          <span className={styles.title}>
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={withBasePath(logo.image)}
                alt=""
                draggable={false}
                loading={compact || eager ? "eager" : "lazy"}
                onError={() => setFailedLogo(logo.image)}
              />
            ) : (
              <span>{film.title}</span>
            )}
          </span>
          <span className={styles.edition}>
            <b>VHS</b>
            {film.year ? <small>{film.year}</small> : null}
          </span>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.plastic}
          src={spineAsset("plastic")}
          alt=""
          draggable={false}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.scratches}
          src={spineAsset("scratches")}
          alt=""
          draggable={false}
        />
      </span>
    </span>
  );
}
