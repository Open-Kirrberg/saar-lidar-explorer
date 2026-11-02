#!/usr/bin/env bash
# Fetch the CC0 texture sets listed in viewer/textures.json into viewer/public/textures/<name>/.
# Source: Poly Haven (CC0). 2K JPG: diff (sRGB colour), nor_gl (OpenGL normal), arm (AO/rough/metal).
# Sequential, polite User-Agent, retries, MD5 verification, idempotent (skips verified files).
# The target folder is git-ignored; viewer/textures.json (committed) is the manifest.
# Usage: bash scripts/fetch-textures.sh [--force]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HERE/viewer/public/textures"
UA="schloss-karlsberg-reconstruction/0.1 (personal heritage research; Saar LiDAR Explorer)"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

md5of() {
  if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1" | cut -d' ' -f1; fi
}

# name|file|url|md5|bytes  (generated from https://api.polyhaven.com/files/<asset> on 2026-11-01)
LIST=$(cat <<'LIST_END'
lime_plaster|diff.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/painted_plaster_wall/painted_plaster_wall_diff_2k.jpg|32f4f4e5ded7d20e55e337004d0d9691|3132937
lime_plaster|nor_gl.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/painted_plaster_wall/painted_plaster_wall_nor_gl_2k.jpg|18faf9f7949aefdb3ae7cef7195cba04|4048392
lime_plaster|arm.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/painted_plaster_wall/painted_plaster_wall_arm_2k.jpg|b66f912016257faa7e71a1530e387545|2159906
slate_roof|diff.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/roof_slates_03/roof_slates_03_diff_2k.jpg|ac4940aeb369dd8c8919d3233cb42023|2083015
slate_roof|nor_gl.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/roof_slates_03/roof_slates_03_nor_gl_2k.jpg|3d52d34312b0e44096ce0db7ad9ee3d2|2741713
slate_roof|arm.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/roof_slates_03/roof_slates_03_arm_2k.jpg|bd5ccc76e0a5be82e53d7fb371128395|3128318
clay_tile_roof|diff.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/ceramic_roof_01/ceramic_roof_01_diff_2k.jpg|9daaf218184c01744fa73f47d0ee1b80|1718697
clay_tile_roof|nor_gl.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/ceramic_roof_01/ceramic_roof_01_nor_gl_2k.jpg|01190556c4f09d7a49fe89317b11458d|2357322
clay_tile_roof|arm.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/ceramic_roof_01/ceramic_roof_01_arm_2k.jpg|ea9afca0981a21f32a29e1717d3bace5|584982
sandstone_ashlar|diff.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/sandstone_blocks_08/sandstone_blocks_08_diff_2k.jpg|2bd2a87974f1870fad58e25da35ed706|1129500
sandstone_ashlar|nor_gl.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/sandstone_blocks_08/sandstone_blocks_08_nor_gl_2k.jpg|5156759065d1550ef60475c46611b89b|954422
sandstone_ashlar|arm.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/sandstone_blocks_08/sandstone_blocks_08_arm_2k.jpg|a8eb587e6eea805266bc5e23401b5d7c|310135
sandstone_flags|diff.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/red_sandstone_pavement/red_sandstone_pavement_diff_2k.jpg|a1259b901bce5c5b428ca1fdbb5c8ac7|2722687
sandstone_flags|nor_gl.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/red_sandstone_pavement/red_sandstone_pavement_nor_gl_2k.jpg|331f734509e5354c74012364d1c19faa|3573918
sandstone_flags|arm.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/red_sandstone_pavement/red_sandstone_pavement_arm_2k.jpg|39b7314228c5066f0b9342502d69b769|2354240
parquet|diff.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/diagonal_parquet/diagonal_parquet_diff_2k.jpg|0a44a53351e723c02ca82baf511e83fa|2948939
parquet|nor_gl.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/diagonal_parquet/diagonal_parquet_nor_gl_2k.jpg|ed709034735ad9ff367e3fa939df4b90|2392214
parquet|arm.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/diagonal_parquet/diagonal_parquet_arm_2k.jpg|822107fb32947cbbe9980d28ca45fa5a|1327302
gravel|diff.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/gravel_floor_02/gravel_floor_02_diff_2k.jpg|db7865191e53523b2b9eabc85a7f73c3|4698557
gravel|nor_gl.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/gravel_floor_02/gravel_floor_02_nor_gl_2k.jpg|6d1c9823f61e798fe15388e99668be7a|5894173
gravel|arm.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/gravel_floor_02/gravel_floor_02_arm_2k.jpg|864559719eba2c5784390aae97f88233|4204438
grass|diff.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/leafy_grass/leafy_grass_diff_2k.jpg|8014f4dace676a62ed71b3dd76119dae|4766204
grass|nor_gl.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/leafy_grass/leafy_grass_nor_gl_2k.jpg|ea5e91abe01dc5e5d7028c68c3bc9194|6047262
grass|arm.jpg|https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/leafy_grass/leafy_grass_arm_2k.jpg|64f2eb364e806301df19edc7a67d65bb|4116600
LIST_END
)

mkdir -p "$DEST"
total=0; fetched=0; skipped=0
while IFS='|' read -r name file url sum bytes; do
  [[ -z "$name" ]] && continue
  dir="$DEST/$name"; out="$dir/$file"
  mkdir -p "$dir"
  if [[ $FORCE -eq 0 && -f "$out" && "$(md5of "$out")" == "$sum" ]]; then
    skipped=$((skipped + 1)); total=$((total + bytes)); continue
  fi
  echo "fetch $name/$file ($((bytes / 1024)) KiB)"
  tmp="$out.part"
  curl --fail --silent --show-error --location --retry 3 --retry-delay 2 \
       --user-agent "$UA" --output "$tmp" "$url"
  got="$(md5of "$tmp")"
  if [[ "$got" != "$sum" ]]; then
    rm -f "$tmp"
    echo "checksum mismatch for $name/$file: expected $sum got $got" >&2
    exit 1
  fi
  mv "$tmp" "$out"
  fetched=$((fetched + 1)); total=$((total + bytes))
  sleep 0.3
done <<< "$LIST"

echo "textures: $fetched fetched, $skipped already present, $((total / 1048576)) MiB in $DEST"
