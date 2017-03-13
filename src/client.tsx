// client.tsx

// REQUIRE HACK
const untypedWindow = window as any
untypedWindow.require = (module:string):any => {
  const map:any = {
    "react": untypedWindow.React,
    "react-dom": untypedWindow.ReactDOM,
    "superagent": untypedWindow.superagent,
  }
  return map[module]
}

// IMPORTS

import * as React from "react"
import * as ReactDOM from "react-dom"
import * as superagent from "superagent"
import { APIResponse, RepoIndex, Repo, Tree, TreeEntry, TreeEntryTree, TreeEntryBlob } from "./server"

// HELPERS

function apiCall<T>(endPoint: string, callback: (error: string|null, result?: T) => void): void {
  const url = endPoint.match(/^https?:/) ? endPoint : `/api${endPoint}`
  superagent.get(url, (error, response) => {
    if (error) {
      callback(error.toString())
    }
    else {
      const apiResult = response.body as APIResponse
      if (apiResult.success) {
        callback(null, apiResult.result as any)
      }
      else {
        callback(apiResult.error)
      }
    }
  })
}

function accessible(callback?:() => void) {
  return (e:React.MouseEvent<HTMLElement>|React.KeyboardEvent<HTMLElement>) => {
    const key = (e as React.KeyboardEvent<HTMLElement>).key || ""
    const tabKey = !!key.match(/^Shift/) || !!key.match(/^Tab/)

    if ((e.type === "click") || ((e.type === "keydown") && !tabKey)) {

      e.preventDefault()
      e.stopPropagation()

      if (!!key.match(/^Arrow/)) {
        const links = document.querySelectorAll("[role='link']")
        const currentTabIndex = e.currentTarget.tabIndex
        let linkIndex = 0
        for (let i = 0; i < links.length; i++) {
          if ((links[i] as HTMLElement).tabIndex === currentTabIndex) {
            linkIndex = i
            break
          }
        }

        let nextIndex:number
        if ((key === "ArrowLeft") || (key === "ArrowUp")) {
          nextIndex = linkIndex > 0 ? linkIndex - 1 : links.length - 1
        }
        else {
          nextIndex = linkIndex < links.length - 1 ? linkIndex + 1 : 0
        }
        if (links[nextIndex]) {
          (links[nextIndex] as HTMLElement).focus()
        }
      }
      else {
        callback && callback()
      }
    }
  }
}

enum TabSection {
  TopNav = 1,
  WorkspaceError = 1000,
  Breadcrumbs = 2000,
  Repos = 3000,
  TreeError = 4000,
  Tree = 5000,
  BlobError = 6000,
  Blob = 7000
}

// BLOB COMPONENT

class Blob extends React.Component<BlobProps, BlobState> {

  constructor(props: BlobProps) {
    super(props)

    this.state = {
      contents: null,
      error: null
    }

    this.loadContents(this.props.blob)
  }

  refs: {
    contents: HTMLPreElement
  }

  componentWillReceiveProps(nextProps:BlobProps) {
    if (this.props.blob !== nextProps.blob) {
      this.loadContents(nextProps.blob)
    }
  }

  componentDidUpdate() {
    if (this.refs.contents) {
      this.refs.contents.focus()
    }
  }

  loadContents(blob: TreeEntryBlob) {
    superagent.get(blob.links.blob, (error, response) => {
      if (error) {
        this.setState({error: error})
      }
      else {
        this.setState({error: null, contents: response.text})
      }
    })
  }

  render() {
    const handleKey = accessible()
    return (
      <div className="blob">
        { this.state.error ? <div className="blob__error" tabIndex={this.props.tabIndex(TabSection.BlobError)}>{this.state.error}</div> : null }
        { this.state.contents ? <pre className="blob__contents" tabIndex={this.props.tabIndex(TabSection.Blob)} ref="contents" onKeyDown={handleKey}>{this.state.contents}</pre> : null }
      </div>
    )
  }
}

interface BlobProps {
  blob: TreeEntryBlob
  tabIndex: (base:number) => number
}

interface BlobState {
  contents: string|null
  error: string|null
}

// TREELIST COMPONENT

class TreeList extends React.Component<TreeListProps, TreeListState> {

  constructor(props: TreeListProps) {
    super(props)

    this.state = {
      tree: null,
      error: null
    }

    this.loadTree(this.props)
  }

  refs: {
    [key: string]: HTMLElement
  }

  componentWillReceiveProps(nextProps:TreeListProps) {
    this.loadTree(nextProps)
  }

  componentDidUpdate() {
    if (this.refs.entry0) {
      this.refs.entry0.focus()
    }
  }

  loadTree(props:TreeListProps) {
    const link = props.tree ? props.tree.links.tree : props.repo ? props.repo.links.tree : null
    if (!link) {
      return
    }

    apiCall<Tree>(link, (error, tree) => {
      if (error || !tree) {
        this.setState({error: error || "Unable to load tree"})
      }
      else {
        this.setState({error: null, tree: tree})
      }
    })
  }

  renderEntry(entry: TreeEntry, index: number) {
    const icon = entry.type === "blob" ? "&#x1f4c4;" : "&#x1f4c1;"
    const selectEntry = accessible(() => this.props.selectEntry(entry))
    return (
      <div className="treelist__entry" key={index} ref={`entry${index}`} role="link" tabIndex={this.props.tabIndex(TabSection.Tree)} onClick={selectEntry} onKeyDown={selectEntry}>
        <span className="treelist__icon" dangerouslySetInnerHTML={{__html: icon}} aria-label={entry.type === "blob" ? "file" : "folder"} />
        <span className="treelist__name">{entry.name}</span>
      </div>
    )
  }

  render() {
    return (
      <div className="treelist">
        { this.state.error ? <div className="treelist__error" tabIndex={this.props.tabIndex(TabSection.TreeError)}>{this.state.error}</div> : null }
        { this.state.tree ? this.state.tree.entries.map(this.renderEntry.bind(this)) : null }
      </div>
    )
  }
}

interface TreeListProps {
  repo: Repo
  tree: TreeEntryTree
  selectEntry: (entry:TreeEntry) => void
  tabIndex: (base:number) => number
}

interface TreeListState {
  tree: Tree|null
  error: string|null
}

// APP COMPONENT

class App extends React.Component<AppProps, AppState> {
  private nextTabIndex:number

  constructor(props: AppProps) {
    super(props)

    this.state = {
      error: null,
      repos: [],
      currentRepo: null,
      treeStack: [],
      blob: null
    }

    apiCall<RepoIndex>("/repos", (error, repoIndex) => {
      if (error || !repoIndex) {
        this.setState({error: error || "Unable to load repos"})
      }
      else {
        this.setState({repos: repoIndex.repos})
      }
    })

    this.nextTabIndex = 1
  }

  refs: {
    [key: string]: HTMLElement
  }

  componentDidUpdate() {
    if (this.refs.repo0) {
      this.refs.repo0.focus()
    }
  }

  tabIndex(base:number) {
    return base + this.nextTabIndex++
  }

  setCurrentRepo(repo:Repo|null) {
    this.setState({
      currentRepo: repo,
      treeStack: [],
      blob: null
    })
  }

  selectTreeEntry(entry:TreeEntry) {
    if (entry.type === "blob") {
      this.setState({
        blob: entry
      })
    }
    else {
      const treeStack = this.state.treeStack.slice()
      treeStack.push(entry)
      this.setState({
        treeStack: treeStack
      })
    }
  }

  selectTreeCrumb(treeEntry:TreeEntryTree) {
    const index = this.state.treeStack.indexOf(treeEntry)
    const treeStack = this.state.treeStack.slice(0, index + 1)
    this.setState({
      treeStack: treeStack,
      blob: null
    })
  }

  renderBreadcrumbs() {
    let keyIndex = 0
    const nextKey = () => `key${keyIndex++}`
    const clearRepo = accessible(() => this.setCurrentRepo(null))
    const selectCurrentRepo = accessible(() => this.setCurrentRepo(this.state.currentRepo))

    const breadcrumbs:JSX.Element[] = [
      <span className="link" role="link" tabIndex={this.tabIndex(TabSection.Breadcrumbs)} key={nextKey()} onClick={clearRepo} onKeyDown={clearRepo}>Repos</span>
    ]

    if (this.state.currentRepo) {
      breadcrumbs.push(<span key={nextKey()} className="workspace__breadcrumbs-spacer">:</span>)
      breadcrumbs.push(<span key={nextKey()} className="link" role="link" tabIndex={this.tabIndex(TabSection.Breadcrumbs)} onClick={selectCurrentRepo} onKeyDown={selectCurrentRepo}>{ this.state.currentRepo.name }</span>)

      breadcrumbs.push(<span key={nextKey()} className="workspace__breadcrumbs-spacer"></span>)
      breadcrumbs.push(<span key={nextKey()}>/</span>)
      this.state.treeStack.forEach((tree) => {
        const selectTreeCrumb = accessible(() => this.selectTreeCrumb(tree))
        breadcrumbs.push(<span key={nextKey()} className="link" role="link" tabIndex={this.tabIndex(TabSection.Breadcrumbs)} onClick={selectTreeCrumb} onKeyDown={selectTreeCrumb}>{tree.name}</span>)
        breadcrumbs.push(<span key={nextKey()}>/</span>)
      })

      if (this.state.blob) {
        breadcrumbs.push(<span key={nextKey()} tabIndex={this.tabIndex(TabSection.Breadcrumbs)}>{this.state.blob.name}</span>)
      }
    }

    return (
      <div className="workspace__breadcrumbs">
        { breadcrumbs }
      </div>
    )
  }

  render() {
    let results
    const clearRepo = accessible(() => this.setCurrentRepo(null))

    this.nextTabIndex = 0

    if (this.state.blob) {
      results = <Blob blob={this.state.blob} tabIndex={this.tabIndex.bind(this)} />
    }
    else if (this.state.currentRepo) {
      const currentTree = this.state.treeStack[this.state.treeStack.length - 1]
      results = <TreeList repo={this.state.currentRepo} tree={currentTree} selectEntry={this.selectTreeEntry.bind(this)} tabIndex={this.tabIndex.bind(this)}></TreeList>
    }
    else {
      const list = this.state.repos.map((repo, i) => {
        const selectRepo = accessible(() => this.setCurrentRepo(repo))
        return <li key={i} ref={`repo${i}`} className="link" role="link" tabIndex={this.tabIndex(TabSection.Repos)} onClick={selectRepo} onKeyDown={selectRepo}>{repo.name}</li>
      })
      results = <ul>{list}</ul>
    }

    return (
      <div className="app">
        <div className="top-nav">
          <div className="top-nav__logo" role="link" tabIndex={this.tabIndex(TabSection.TopNav)} onClick={clearRepo} onKeyDown={clearRepo}>Git Repo Browser</div>
        </div>
        <div className="workspace">
          { this.state.error ? <div className="workspace__error" tabIndex={this.tabIndex(TabSection.WorkspaceError)}>{this.state.error}</div> : null }
          <div className="workspace__results">
            { this.renderBreadcrumbs() }
            { results }
          </div>
        </div>
      </div>
    )
  }
}

interface AppProps {
}

interface AppState {
  error: string|null
  repos: Repo[]
  currentRepo: Repo|null
  treeStack: TreeEntryTree[]
  blob: TreeEntryBlob|null
}

// APP RENDERER

ReactDOM.render(<App />, document.getElementById("app-container"))