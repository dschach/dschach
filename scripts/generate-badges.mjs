import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { makeBadge } from 'badge-maker';
import * as simpleIcons from 'simple-icons';

const README = 'README.md';
const BADGES_JSON = 'badges/badges.json';
const LOGO_DIR = 'media/logos';
const OUTPUT_DIR = 'media/badges';
const GENERATED_SECTIONS = ['skills', 'contact'];
const MIME_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };

const iconsBySlug = new Map(
	Object.values(simpleIcons)
		.filter((icon) => icon?.slug)
		.map((icon) => [icon.slug, icon])
);

const toDataUri = (buffer, mimeType) => `data:${mimeType};base64,${buffer.toString('base64')}`;

function recolorSvg(svg, color) {
	return svg.replace(/<svg\b([^>]*)>/, (_, attributes) => {
		const withoutFill = attributes.replace(/\sfill="[^"]*"/, '');
		return `<svg fill="${color}"${withoutFill}>`;
	});
}

function builtinLogo({ logo, logoColor }) {
	const icon = iconsBySlug.get(logo);
	if (!icon) throw new Error(`no simple-icons slug "${logo}"`);
	return toDataUri(Buffer.from(recolorSvg(icon.svg, logoColor ?? `#${icon.hex}`)), 'image/svg+xml');
}

function customLogo({ logo, logoColor }) {
	const path = join(LOGO_DIR, logo);
	if (!existsSync(path)) throw new Error(`missing logo file ${path}`);
	const mimeType = MIME_TYPES[extname(logo).toLowerCase()];
	if (!mimeType) throw new Error(`unsupported logo type ${logo}`);
	if (mimeType === 'image/svg+xml' && logoColor) {
		return toDataUri(Buffer.from(recolorSvg(readFileSync(path, 'utf8'), logoColor)), mimeType);
	}
	return toDataUri(readFileSync(path), mimeType);
}

function renderBadge(badge) {
	const logoBase64 = badge.logoType === 'builtin' ? builtinLogo(badge) : customLogo(badge);
	const { label, message, color, labelColor, style } = badge;
	const format = { label, message, color, labelColor, style, logoBase64 };
	return makeBadge(Object.fromEntries(Object.entries(format).filter(([, value]) => value !== undefined)));
}

const withLink = (image, url) => (url ? `[${image}](${url})` : image);

const data = JSON.parse(readFileSync(BADGES_JSON, 'utf8'));
mkdirSync(OUTPUT_DIR, { recursive: true });
for (const file of readdirSync(OUTPUT_DIR).filter((name) => name.endsWith('.svg'))) {
	rmSync(join(OUTPUT_DIR, file));
}

const markdown = {};
const failures = [];

markdown.profile = data.profile.badges.filter((badge) => !badge.hidden).map((badge) => withLink(`![${badge.alt}](${badge.imageUrl})`, badge.url));

for (const section of GENERATED_SECTIONS) {
	markdown[section] = [];
	for (const badge of data[section].badges) {
		if (badge.hidden) continue;
		const fileName = `${section}-${badge.id}.svg`;
		try {
			writeFileSync(join(OUTPUT_DIR, fileName), renderBadge(badge));
		} catch (error) {
			failures.push(`${section}/${badge.id}: ${error.message}`);
			continue;
		}
		const alt = [badge.label, badge.message].filter(Boolean).join(' ');
		markdown[section].push(withLink(`![${alt}](${OUTPUT_DIR}/${fileName})`, badge.url));
	}
}

if (failures.length) {
	console.error(`${failures.length} badge(s) not generated, README left unchanged:`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

let readme = readFileSync(README, 'utf8');
for (const [section, lines] of Object.entries(markdown)) {
	const start = `<!-- badges:${section}:start -->`;
	const end = `<!-- badges:${section}:end -->`;
	const startIndex = readme.indexOf(start);
	const endIndex = readme.indexOf(end);
	if (startIndex === -1 || endIndex < startIndex) {
		console.error(`${README} is missing the ${section} badge markers: ${start} ... ${end}`);
		process.exit(1);
	}
	// Blank lines match what Prettier produces, so the pre-commit hook and CI agree
	readme = `${readme.slice(0, startIndex + start.length)}\n\n${lines.join('\n')}\n\n${readme.slice(endIndex)}`;
}
writeFileSync(README, readme);
console.log(`Wrote ${readdirSync(OUTPUT_DIR).length} SVG badges to ${OUTPUT_DIR} and updated ${Object.values(markdown).flat().length} README badge links`);
