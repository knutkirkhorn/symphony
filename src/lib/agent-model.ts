import type {AgentModelOption, AgentRunModelChoice} from '@/lib/types';

export function resolveRunModelFromInput(
	raw: string,
	options: AgentModelOption[],
): AgentRunModelChoice {
	if (!raw) {
		return {shortName: '', prettyName: ''};
	}
	const trimmed = raw.trim();
	const hasOuterWhitespace = raw !== trimmed;
	if (!trimmed) {
		return {shortName: '', prettyName: raw};
	}
	const byId = options.find(option => option.id === trimmed);
	if (byId) {
		return {
			shortName: byId.id,
			prettyName: hasOuterWhitespace ? raw : byId.name,
		};
	}
	const byName = options.find(
		option => option.name.toLowerCase() === trimmed.toLowerCase(),
	);
	if (byName) {
		return {
			shortName: byName.id,
			prettyName: hasOuterWhitespace ? raw : byName.name,
		};
	}
	return {shortName: trimmed, prettyName: raw};
}

export function runModelChoiceToDisplay(
	choice: AgentRunModelChoice | undefined,
): string {
	if (!choice || (!choice.shortName && !choice.prettyName)) {
		return '';
	}
	if (choice.prettyName && choice.prettyName !== choice.shortName) {
		return choice.prettyName;
	}
	return choice.shortName;
}
