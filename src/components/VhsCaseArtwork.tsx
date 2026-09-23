import { withBasePath } from "@/lib/basePath";
import { useState } from "react";
import { cassetteLabelImage } from "@/lib/cassetteArtwork";
import cassetteLogos from "@/data/filmCassetteLogos.json";
import cassetteLabels from "@/data/filmCassetteLabels.json";
import styles from "@/styles/filmClubProgram.module.css";

/** Shared artwork: the demo exercises the same layers as the vote wall. */
export function VhsCaseArtwork({
  coverImage,
  title,
  eager = false,
}: {
  coverImage: string;
  title: string;
  eager?: boolean;
}) {
  const titleLogo = cassetteLogos[coverImage as keyof typeof cassetteLogos];
  const [failedLabel, setFailedLabel] = useState<string>();
  const labelImage = cassetteLabelImage(
    coverImage,
    cassetteLabels[coverImage as keyof typeof cassetteLabels],
    failedLabel,
  );
  return (
    <>
      <span className={styles.voteCaseInterior} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.voteCaseShell}
          src={withBasePath("/VHS/program/case-underlay-trimmed.avif")}
          alt=""
          draggable={false}
        />
        <span className={styles.voteCassetteTray}>
          <span className={styles.voteCassetteBody}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.voteCassette}
              src={withBasePath("/VHS/program/cassette-trimmed.avif")}
              alt=""
              draggable={false}
            />
            <span className={styles.voteCassetteLabel}>
              <span className={styles.voteCassettePrint}>
                {labelImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={withBasePath(labelImage)}
                    alt=""
                    draggable={false}
                    loading={eager ? "eager" : "lazy"}
                    onError={() => {
                      if (labelImage !== coverImage) setFailedLabel(labelImage);
                    }}
                  />
                ) : null}
                <span
                  className={styles.voteCassetteTitle}
                  data-surface={titleLogo?.surface}
                >
                  {titleLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={withBasePath(titleLogo.image)}
                      alt=""
                      draggable={false}
                      loading={eager ? "eager" : "lazy"}
                    />
                  ) : (
                    title
                  )}
                </span>
              </span>
            </span>
            <span className={styles.voteCassetteSpine}>{title}</span>
          </span>
        </span>
      </span>
      <span className={styles.voteCaseCover} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath(coverImage)}
          alt=""
          draggable={false}
          loading={eager ? "eager" : "lazy"}
        />
      </span>
    </>
  );
}
