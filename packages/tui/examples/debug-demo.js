import { Input, matchesKey, ProcessTerminal, Text, TUI } from "../src";
class DemoChoices {
    debugId = "choices";
    debugKind = "ChoiceList";
    #choices = ["alpha", "beta", "gamma"];
    #selected = 0;
    render(_width) {
        return this.#choices.map((choice, index) => `${index === this.#selected ? ">" : " "} ${choice}`);
    }
    debugState() {
        return { selected: this.#choices[this.#selected] };
    }
}
const tui = new TUI(new ProcessTerminal());
const title = new Text("TAU TUI debug demo", 0, 0);
const debugTitle = title;
debugTitle.debugId = "title";
const input = new Input();
const debugInput = input;
debugInput.debugId = "input";
input.prompt = "Name: ";
const choices = new DemoChoices();
tui.addChild(title);
tui.addChild(input);
tui.addChild(choices);
tui.setFocus(input);
tui.addInputListener(data => {
    if (!matchesKey(data, "ctrl+c"))
        return undefined;
    tui.stop();
    process.exit(0);
});
tui.start();
