import { exec } from 'child_process';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const treeDataProvider = new ScreenTreeDataProvider();
	vscode.window.createTreeView('screenTreeView', { treeDataProvider });


	context.subscriptions.push(
		vscode.commands.registerCommand('screenTreeView.removeAllScreens', async () => {
			const confirmation = await vscode.window.showWarningMessage(
				'Are you sure you want to remove all screen sessions?',
				{ modal: true },
				'Yes',
				'No'
			);

			if (confirmation === 'Yes') {
				try {
					await runCommand('screen -S $(screen -ls | awk \'/\t/ {print $1}\') -X quit');
					vscode.window.showInformationMessage('All screen sessions have been removed.');
					// Refresh the tree view after removing sessions
					treeDataProvider.refresh();
				} catch (error) {
					vscode.window.showErrorMessage('Failed to remove all screen sessions.');
				}
			}
		})
	);

	// Register the new command to create a screen session
    context.subscriptions.push(
        vscode.commands.registerCommand('screenTreeView.createNewScreen', async () => {
            const newSessionName = await vscode.window.showInputBox({
                prompt: 'Enter a name for the new screen session',
                placeHolder: 'screen-session-name',
            });

            if (newSessionName) {
                createNewScreenSession(newSessionName);
            }
        })
    );

	// Register commands
	vscode.commands.registerCommand('extension.openScreenSession', (item: ScreenItem) => {
		openScreenSession(item);
	});

	vscode.commands.registerCommand('extension.killScreenSession', (item: ScreenItem) => {
		killScreenSession(item);
	});

	vscode.commands.registerCommand('extension.renameScreenSession', (item: ScreenItem) => {
		renameScreenSession(item);
	});

	const terminalStateChangeListener = vscode.window.onDidChangeTerminalState((terminal) => {
        // This event fires when any terminal's state changes
        treeDataProvider.refresh();
    });

	// Register the refresh command
	vscode.commands.registerCommand('screenTreeView.refresh', () => {
		treeDataProvider.refresh();
	});

	context.subscriptions.push(treeDataProvider,terminalStateChangeListener);
}

function createNewScreenSession(sessionName: string) {
    const command = `screen -S ${sessionName} -d -m`;  // Create detached screen session
    exec(command, (error, stdout, stderr) => {
        if (error) {
            vscode.window.showErrorMessage(`Error creating screen session: ${stderr}`);
            return;
        }
		openScreenSession(new ScreenItem(sessionName,sessionName));
        vscode.window.showInformationMessage(`Screen session '${sessionName}' created.`);
        // Optionally, trigger a refresh of the tree view after creating a session
        vscode.commands.executeCommand('screenTreeView.refresh');
    });
}

// Function to open a screen session
function openScreenSession(item: ScreenItem) {
	if (!item) {
        vscode.window.showErrorMessage("No session ID provided.");
        return;
    }
	vscode.window.showInformationMessage(`Opening Screen session ${item.id}:`);
	// Here you can add logic to open the screen session

	// Create a new terminal in VS Code
	const terminalName = `${item.label}`;
	const existingTerminal = vscode.window.terminals.find(term => term.name === terminalName);
	if (existingTerminal) {
        // If it exists, show the existing terminal
        existingTerminal.show();
    } else {
        // If it doesn't exist, create a new terminal with -d option
        const newTerminal = vscode.window.createTerminal({
            name: terminalName,
            // Send the command to run in the new terminal
            // Here we use -d to detach and reattach to the session
            shellPath: 'screen',
            shellArgs: ['-d', '-r', item.id], // Detach and attach to the session
        });
        newTerminal.show(); // Show the terminal to the user
    }
}


// Function to kill a screen session
function killScreenSession(item: ScreenItem) {
	vscode.window.showInformationMessage(`Killing Screen session ${item.id}`);
	// Here you can add logic to kill the screen session

	const terminalName = `${item.label}`;

	// Find the terminal with the matching name
	const existingTerminal = vscode.window.terminals.find(term => term.name === terminalName);


	runCommand(`screen -S ${item.id} -X quit`)
		.then(() => {
			// Notify the user that the session has been killed
			vscode.window.showInformationMessage(`Screen session ${item.id} has been killed.`);
			// If there's a matching terminal, dispose (close) it
			if (existingTerminal) {
				existingTerminal.dispose(); // This closes the terminal in VSCode
			}
			// Refresh the tree view after killing the session
			vscode.commands.executeCommand('screenTreeView.refresh');

		})
		.catch(error => {
			// Notify the user if there was an error
			vscode.window.showErrorMessage(`Failed to kill session ${item.id}: ${error}`);
		});
}

// Function to rename a screen session
function renameScreenSession(item: ScreenItem) {
	vscode.window.showInputBox({
		prompt: 'Enter the new name for the screen session',
		value: item.label,  // Pre-fill the current session name
		validateInput: (input: string) => {
			return input.trim() === '' ? 'Session name cannot be empty' : null;
		}
	}).then((newName) => {
		if (newName && newName.trim() !== '' && newName !== item.label) {
			renameScreen(item.id, newName).then(() => {
				vscode.commands.executeCommand('screenTreeView.refresh'); // Trigger refresh
			}).catch((error) => {
				vscode.window.showErrorMessage(`Failed to rename session: ${error}`);
			});
		}
	});
}

// Function to execute the rename screen command
function renameScreen(sessionId: string, newName: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const command = `screen -S ${sessionId} -X sessionname ${newName}`;
		exec(command, (error, stdout, stderr) => {
			if (error) {
				reject(stderr);
			} else {
				resolve();
			}
		});
	});
}

function runCommand(command: string): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout) => {
			if (error) {
				vscode.window.showErrorMessage(`Error executing command: ${error.message}`);
				return resolve("");
			}
			resolve(stdout);
		});
	});
}


class ScreenTreeDataProvider implements vscode.TreeDataProvider<ScreenItem>, vscode.Disposable {
	private _onDidChangeTreeData: vscode.EventEmitter<ScreenItem | undefined> = new vscode.EventEmitter<ScreenItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<ScreenItem | undefined> = this._onDidChangeTreeData.event;

	getTreeItem(element: ScreenItem): vscode.TreeItem {
		return element;
	}

	private isCommandAvailable(command: string): Promise<boolean> {
		return new Promise((resolve) => {
			exec(`command -v ${command}`, (error) => {
				resolve(!error); // Se non ci sono errori, il comando è disponibile
			});
		});
	}

	async getChildren(element?: ScreenItem): Promise<ScreenItem[]> {

		const isScreenAvailable = await this.isCommandAvailable('screen');

		const items: ScreenItem[] = [];

		if (!isScreenAvailable) {
			items.push(new ScreenItem("The system doesn't support screen", "screen_no_support"));
			return items;
		}

		const output = await runCommand('screen -ls');
		return this.parseScreenOutput(output);
	}

	dispose(): void {
		// Emetti un evento per segnalare che i dati della TreeView sono cambiati
		this._onDidChangeTreeData.dispose();
	}

	// Add a refresh function to trigger a tree view update
	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}


	private parseScreenOutput(output: string): ScreenItem[] {
		const lines = output.split('\n');
		const items: ScreenItem[] = [];
		if(output.includes("There is no screen to be resumed")){
			return items;
		}

		lines.forEach(line => {
			if (line.startsWith("\t")) {
				const tmp = line.split("\t").slice(1);
				const id_name = tmp[0].match(/(\d+)\.(.+)/)?.slice(1);

				if (id_name) {
					const status = tmp.at(-1) ?? "";

					items.push(new ScreenItem(id_name[1].trim(), id_name[0].trim(), new vscode.ThemeIcon(status.includes("Attached") ? 'issue-opened' : 'issue-closed')));

				}
			}
		});

		return items;
	}
}

class ScreenItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly id: string,
		public readonly iconPath?: string | vscode.ThemeIcon | undefined, // Use this to specify the icon
		public readonly command?: vscode.Command,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
	) {
		super(label, collapsibleState);
		if (!command && id != "screen_no_support") {
			this.command = {
				command: 'extension.openScreenSession', // Your command ID
				title: 'Open Screen Session',
				arguments: [this], // Pass the session ID as an argument
			};
		} else {
			this.command = command; // Otherwise, use the provided command
		}// Set command property directly
	}
}