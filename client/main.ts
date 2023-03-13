import p5 from 'p5';
import * as Honeycomb from 'honeycomb-grid';
import {TanksHex} from "../server/app/board";
import {Tank} from "./models/Tank";
import {
    GameGraphics,
    GameState,
    HEX_HEIGHT,
    HEX,
    HEX_WIDTH, MAIN_BORDER_HEIGHT,
    pictures,
    States,
    UI_WIDTH,
    OFFSET, Buffs, BuffsDescriptions
} from "./consts";
import {drawPopup} from "./game/ui/popups";
import {io} from "socket.io-client";
import {createAuth0Client} from '@auth0/auth0-spa-js';
import {drawBoard} from "./game/ui/board";
import MicroModal from 'micromodal';
import {drawCursor, handleViewport} from './game/ui/mouse';
import {drawEvents, setOnline} from "./game/ui/html-elements";
import {execAction, validateAction} from "./game/message-sender";
import {ActionResult} from "../server/app/action-result";

MicroModal.init();


new p5((p5) => {


    let configFetched = false;
    let sio: any;
    let visibleActions = false;

    let stage = 'RUN';
    // AUTH
    let auth0: any;

    const voteSelect = document.querySelector('select#vote') as HTMLSelectElement;
    const pollForm = document.querySelector('form#poll') as HTMLFormElement;
    const showPollResultsButton = document.querySelector('button#show-poll-results') as HTMLButtonElement;
    const actionsContainer = document.querySelector('#actions') as HTMLDivElement;
    const pollResultsContainer = document.querySelector('#poll-results') as HTMLDivElement;
    const pollResultsTable = document.querySelector('#poll-results-table') as HTMLTableElement;
    const modalOverlay = document.querySelector('#modal-overlay') as HTMLDivElement;
    const loginButton = document.querySelector('#btn-login') as HTMLButtonElement;
    const logoutButton = document.querySelector('#btn-logout') as HTMLButtonElement;
    const actionButtons = document.querySelectorAll(`#actions  button`) as NodeListOf<HTMLButtonElement>;
    const boardContainer = document.querySelector('#board-holder') as HTMLDivElement;
    const intro = document.querySelector('#intro') as HTMLDivElement;
    const rightSide = document.querySelector('#right-side') as HTMLDivElement;
    const guestBox = document.querySelector('#guest-box') as HTMLDivElement;
    const playerImage = document.querySelector('#player-image') as HTMLImageElement;
    const playerBox = document.querySelector('#player-box') as HTMLDivElement;
    const playerName = document.querySelector('#player-name') as HTMLDivElement;
    const playerHealth = document.querySelector('#player-health') as HTMLDivElement;
    const playerActions = document.querySelector('#player-actions') as HTMLDivElement;
    const playerBuffs = document.querySelector('#user-buffs') as HTMLDivElement;
    const playerSight = document.querySelector('#player-sight') as HTMLDivElement;
    const boardHolder = document.querySelector('#board-holder') as HTMLDivElement;

    pollForm.addEventListener('submit', event => {
        event.preventDefault();
        sio.emit('playerevent', 'vote', voteSelect.value, (response: any) => {
            if (!response) {
                alert(`Well, no. You already voted today. The blockchain doesn't lie`)
            } else {
                alert('Thank you!')
            }
        })
    })

    showPollResultsButton.addEventListener('click', event => {
        event.preventDefault();
        // pollResultsContainer.classList.remove('hidden');
        // modalOverlay.classList.remove('hidden');

        MicroModal.show('jury-modal', {
            onShow: () => {
                console.log('show')
                getJson('poll')
                    .then(response => {
                        pollResultsTable.innerHTML = response.map((row: any) => `
<tr>
    <td><img class="img-thumbnail" src="${row.picture}" alt="${row.name}"></td>
    <td>${row.name}</td>
    <td>${row.count}</td>
</tr>
                `).join('')
                    })
                    .catch(console.error)
            }
        });


    })


    const fetchAuthConfig = () => fetch("/auth_config.json");
    const configureClient = async () => {
        const response = await fetchAuthConfig();
        const config = await response.json();

        auth0 = await createAuth0Client({
            domain: config.domain,
            clientId: config.clientId,
            authorizationParams: {
                audience: config.audience,
                redirect_uri: window.location.origin
            }
        });
    };

    async function updateLoginUi() {
        const isAuthenticated = await auth0.isAuthenticated();
        loginButton.disabled = isAuthenticated;
        logoutButton.disabled = !isAuthenticated;

        if (isAuthenticated) {
            boardContainer.classList.remove('hidden');
            rightSide.classList.remove('hidden');
            intro.classList.add('hidden');
        } else {
            boardContainer.classList.add('hidden');
            rightSide.classList.add('hidden');
            intro.classList.remove('hidden');
        }

    }

    window.onload = async () => {
        await configureClient();

        await updateLoginUi();

        const isAuthenticated = await auth0.isAuthenticated();

        if (isAuthenticated) {
            await initCanvas()
            return;
        }

        // NEW - check for the code and state parameters
        const query = window.location.search;
        if (query.includes("code=") && query.includes("state=")) {

            // Process the login state
            await auth0.handleRedirectCallback();

            await updateLoginUi();

            // Use replaceState to redirect the user away and remove the querystring parameters
            window.history.replaceState({}, document.title, "/");

            await initCanvas()
        }
    }

    window.onresize = () => {
        GameState.WIDTH = window.innerWidth - UI_WIDTH;
        GameState.HEIGHT = window.innerHeight - MAIN_BORDER_HEIGHT;

        // p5.resizeCanvas(GameState.WIDTH, GameState.HEIGHT);
    }

    function resizeGrid(grid: any) {
        grid.hexSettings.dimensions = {
            xRadius: HEX.SIDE,
            yRadius: HEX.SIDE
        }
        return grid;
    }

    function setupLocalGrid(grid: any) {
        const resizedGrid = resizeGrid(grid);

        const TanksHex = class extends Honeycomb.defineHex(resizedGrid.hexSettings) {
            tank: Tank | null = null;
            tile: number = 0;

            constructor({q, r, tank, tile}: { q: number, r: number, tank: Tank | null, tile: number }) {
                super({q, r});
                this.tank = tank;

                if (this.tank && tank) {
                    this.tank.buffs = new Set(tank.buffs);
                }

                this.tile = tile
            }
        }
        // non ho voglia di capire e tempo come tipizzare questo
        // @ts-ignore
        GameState.localGrid = new Honeycomb.Grid<TanksHex>(TanksHex, resizedGrid.coordinates);
    }

    async function initCanvas() {

        const c = await getJson('/config');
        configFetched = true;
        setupLocalGrid(c.grid);

        // GameState.WIDTH = c.cols * HEX_WIDTH + OFFSET.X;
        // GameState.HEIGHT = c.rows * HEX_HEIGHT + OFFSET.Y;

        GameState.WIDTH = window.innerWidth - UI_WIDTH;
        GameState.HEIGHT = window.innerHeight - MAIN_BORDER_HEIGHT;

        // p5.resizeCanvas(GameState.WIDTH, GameState.HEIGHT);
        p5.resizeCanvas(
            c.cols * HEX_WIDTH + OFFSET.X,
            c.rows * HEX_HEIGHT + OFFSET.Y
        )

        // MAGIC: 69 is SUPER RANDOM
        // I don't properly understand how to calculate the size of the mask
        // GameGraphics.maskGraphics = p5.createGraphics(75, 75);
        GameGraphics.maskGraphics = p5.createGraphics(HEX_WIDTH , HEX_HEIGHT);

        const jwt = await auth0.getTokenSilently()
        connectSocket(jwt);

        GameState.players = await getJson('/players')
        GameState.events = await getJson('/events')

        // drawEvents()
    }

    loginButton.addEventListener('click', () => {
        auth0.loginWithRedirect();
    })

    logoutButton.addEventListener('click', () => {
        auth0.logout();
    })


    function connectSocket(jwt: string) {
        sio = io('', {
            auth: {
                token: `Bearer ${jwt}`
            }
        });

        sio.on('player', setPlayer)
        // sio.on('message', newMessage);
        sio.on('board', updateBoard);
        sio.on('playerslist', setOnline);
        // sio.on('action', addPlayerAction)

        sio.on('connect_error', (error: any) => {
            console.error(error)
        })
    }

    actionButtons.forEach(el => {
        el.addEventListener('click', function () {

            if (!GameState.player) {
                return;
            }

            const state = this.getAttribute('data-action')!;
            if (!Object.values(States).includes(state)) {
                return
            }

            if (state === States.UPGRADE) {
                execAction(sio, null, States.UPGRADE)
                    .catch(console.log);
            } else {
                if (GameState.currentState === state) {
                    GameState.currentState = States.IDLE
                } else {
                    GameState.currentState = state;
                }
            }

        })
    })


    function addPlayerAction(action: any) {
        GameState.events.unshift(action)
        // drawEvents();
    }

    function updateBoard(serverMessage: string) {

        const parsedMessage = JSON.parse(serverMessage);
        setupLocalGrid(parsedMessage.grid);

        const playersList: Tank[] = [];

        if (GameState.localGrid) {
            GameState.localGrid.forEach(hex => {
                if (hex.tank) {
                    playersList.push(hex.tank);
                }

                if (hex.tank) {
                    if (!pictures[hex.tank.id]) {
                        pictures[hex.tank.id] = p5.loadImage(hex.tank.picture)
                    }
                }

                if (hex.tank && hex.tank.id === GameState.playerId) {
                    GameState.player = hex.tank;
                }
            })
        }

        if (GameState.player) {
            guestBox.classList.add('hidden');
            playerBox.classList.remove('hidden');

            if (playerImage.src !== GameState.player.picture) {
                playerImage.src = GameState.player.picture;
            }

            playerName.textContent = GameState.player.name;
            playerHealth.textContent = GameState.player.life.toString();
            playerActions.textContent = GameState.player.actions.toString();
            playerSight.textContent = GameState.player.range.toString();
            playerBuffs.innerHTML = Array.from(GameState.player.buffs).map(b => {

                const title = BuffsDescriptions[b].name + `: ${BuffsDescriptions[b].description}`;
                const emoji = BuffsDescriptions[b].icon;
                return `<li title="${title}">${emoji}</li>`
            }).join('');
        } else {
            guestBox.classList.remove('hidden');
            playerBox.classList.add('hidden');
        }

        if (GameState.player && GameState.player.life > 0) {
            actionsContainer.classList.remove('hidden');
            visibleActions = true;

            if (GameState.player.actions < 1) {
                Array.from(actionButtons).forEach(el => {
                    el.setAttribute(`disabled`, `true`);
                });
            }

            if (GameState.player.actions > 0) {
                Array.from(actionButtons).forEach(el => {
                    el.removeAttribute(`disabled`)
                });
            }

            if (GameState.player.actions < 3) {
                Array.from(actionButtons)
                    .filter(el => {
                        return el.getAttribute('data-action') === States.UPGRADE || el.getAttribute('data-action') === States.HEAL
                    })
                    .forEach(el => {
                        el.setAttribute(`disabled`, 'true');
                    });
            }


            pollForm.classList.add('hidden')
        }

        if (GameState.player && GameState.player.life <= 0) {
            visibleActions = false;
            actionsContainer.classList.add('hidden');
            pollForm.classList.remove('hidden')
        }


        GameState.heartsLocations = parsedMessage.features.heartsLocations;
        GameState.actionsLocations = parsedMessage.features.actionsLocations;
        GameState.buildings = parsedMessage.features.buildings;

        voteSelect.innerHTML = playersList
            .filter(p => p.life > 0)
            .map(p => `
            <option value=${p.id}>${p.name}</option>
        `)
            .join('')

        // debugger;

    }

    function setPlayer(id: string) {
        GameState.playerId = id;
    }


    async function getJson(url: string): Promise<any> {
        const token = await auth0.getTokenSilently();
        return fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        })
            .then(response => response.json())
            .catch(console.error);
    }

    p5.preload = function () {
        GameGraphics.tiles = [
            p5.loadImage('./assets/grass.png'),
            p5.loadImage('./assets/sea.png'),
            p5.loadImage('./assets/desert.png'),
            p5.loadImage('./assets/forest.png'),
            p5.loadImage('./assets/mountain.png'),
            p5.loadImage('./assets/swamp.png'),
            p5.loadImage('./assets/ice.png'),
            p5.loadImage('./assets/lava.png'),
        ]

        GameGraphics.oasisImage = p5.loadImage('./assets/oasis.webp');
        GameGraphics.iceFortressImage = p5.loadImage('./assets/ice_fortress.webp');
        GameGraphics.castleImage = p5.loadImage('./assets/castle.png');
        GameGraphics.orcsCampImage = p5.loadImage('./assets/orc_camp.png');
        GameGraphics.teleportImage = p5.loadImage('./assets/teleport.png');
        GameGraphics.piratesImage = p5.loadImage('./assets/pirates.png');
    }

    p5.setup = function () {
        const canvas = p5.createCanvas(100, 100);
        canvas.parent('board-holder')

        GameGraphics.maskGraphics = p5.createGraphics(75, 75);

        p5.frameRate(10)
    }

    p5.draw = function () {

        // handleViewport(p5);

        GameState.activePlayerHover = null;

        p5.clear();
        if (!configFetched || !GameState.localGrid) {
            return;
        }

        if (stage === 'RUN') {
            drawBoard(p5);
        }

        drawCursor(p5);
        drawPopup(p5);

    }

    p5.keyPressed = function () {

        // console.log(p5.keyCode)
        if (!GameState.player) {
            return;
        }

        const state = (() => {
            switch (p5.keyCode) {
                case 77:
                    return States.MOVE;
                case 72:
                    return States.HEAL;
                case 65:
                    return States.SHOOT;
                case 71:
                    return States.GIVE_ACTION;
                case 80:
                    GameState.debug = !GameState.debug;
                    return null;
                default:
                    return null;
            }
        })()

        if (!state) {
            return;
        }

        if (!Object.values(States).includes(state)) {
            return
        }

        if (state === States.UPGRADE) {
            execAction(sio, null, States.UPGRADE)
                .catch(console.log);
        } else {
            if (GameState.currentState === state) {
                GameState.currentState = States.IDLE
            } else {
                GameState.currentState = state;
            }
        }
    }

    p5.mouseClicked = function () {

        const boardHolderSize = boardHolder.getBoundingClientRect();

        // check if the click is inside the boardHolder
        if (p5.mouseX - boardHolder.scrollLeft > boardHolderSize.width) {
            return;
        }

        if (!GameState.hasFocus) {
            return;
        }

        if (GameState.currentState === States.IDLE) {
            const hex = GameState.localGrid!.pointToHex(
                {x: p5.mouseX - OFFSET.X, y: p5.mouseY - OFFSET.Y},
                {allowOutside: false}
            );
            if (hex) {
                return;
            }
        }

        const hex = GameState.localGrid!.pointToHex(
            {x: p5.mouseX - OFFSET.X, y: p5.mouseY - OFFSET.Y},
            {allowOutside: false}
        );
        if (hex) {

            if (GameState.currentState !== States.SHOOT) {
                execAction(sio, hex)
                    .then(() => {
                        GameState.currentState = States.IDLE;
                    })
                    .catch(console.log)
                return;
            }

            validateAction(sio, hex)
                .then((isValid: boolean) => {

                    MicroModal.show('action-confirm', {
                        onShow: () => {

                            GameState.hasFocus = false;

                            const modal = document.getElementById('action-confirm') as HTMLDivElement;
                            const modalTitle = modal.querySelector('.modal__title') as HTMLHeadingElement;
                            modalTitle.textContent = `Attacco`;

                            const actionTemplate = document.getElementById(`${GameState.currentState}-content`) as HTMLTemplateElement;
                            const clone = actionTemplate.content.cloneNode(true) as HTMLElement;
                            (clone.querySelector('.you') as HTMLImageElement).src = GameState.player?.picture as string;
                            (clone.querySelector('.target') as HTMLImageElement).src = hex.tank!.picture;

                            modal.querySelector('.modal__content')!.append(clone);
                            const attackResultTitle = modal.querySelector('.attack-result h3') as HTMLHeadingElement;
                            const attackResultText = modal.querySelector('.attack-result p') as HTMLParagraphElement;
                            const attackButton = modal.querySelector('.attack-button') as HTMLButtonElement;

                            modal.querySelector('.attack-button')!.addEventListener('click', () => {
                                execAction(sio, hex)
                                    .then((actionResult: ActionResult) => {

                                        attackButton.style.display = 'none';

                                        console.log(`actionResult`, actionResult)
                                        if (actionResult.exit === true) {
                                            attackResultTitle.innerHTML = `L'hai colpito!`;
                                        } else {
                                            attackResultTitle.innerHTML = `OH NOOOO!`;
                                            switch (actionResult.failReason) {
                                                case 0:
                                                    attackResultText.innerHTML = `La sua armatura di ghiaccio ha bloccato l'attacco!`;
                                                    break;
                                                case 5:
                                                    attackResultText.innerHTML = `Non hai più azioni per attaccare!`;
                                                    break;
                                                case 6:
                                                    attackResultText.innerHTML = `Dannazione, quel codardo se n'è già andato!`;
                                                    break;
                                                case 9:
                                                    attackResultText.innerHTML = `La sue pelle orchesca ha bloccato il tuo attacco!`;
                                                    break;
                                                default:
                                                    attackResultText.innerHTML = `L'attacco è andato a vuoto`;
                                                    break;
                                            }
                                        }

                                        if (actionResult.successMessage === 0) {
                                            attackResultTitle.innerHTML += `<br/> Arggh! Uno dei tuoi trucchi da pirata l'ha anche indebolito`;
                                        }

                                        GameState.currentState = States.IDLE;

                                    })
                                    .catch(console.log)

                            })

                        },
                        // @ts-ignore
                        onClose: (modal: HTMLElement, trigger: HTMLElement, event: MouseEvent) => {
                            GameState.hasFocus = true;
                            modal.querySelector('.modal__content')!.innerHTML = '';
                        }
                    });

                })
                .catch(() => {
                    // DO NOTHING
                })
        }

    }

})




