// server.ts
import * as express from "express"
import * as path from "path"
import * as fs from "fs"
import * as url from "url"
import { StringDecoder } from "string_decoder"
import { spawn } from "child_process"

// HELPER INTERFACES
interface InvalidRepoFolder {
  type: "invalid"
  error: string
  code: number
}
interface ValidRepoFolder {
  type: "valid"
  folder: string
  path: string
}
type RepoFolder = InvalidRepoFolder | ValidRepoFolder

// API
export interface APIIndex {
  links: {
    self: string
    repos: string
  }
}
export interface RepoIndex {
  repos: Repo[]
  links: {
    self: string
    parent: string
  }
}
export interface Repo {
  name: string
  slug: string
  links: {
    tree: string
    self: string
    parent: string
  }
}
export interface Tree {
  entries: TreeEntry[]
  links: {
    self: string
  }
}

export interface TreeEntryTree {
  type: "tree"
  mode: string
  sha: string
  name: string
  links: {
    tree: string
  }
}
export interface TreeEntryBlob {
  type: "blob"
  mode: string
  sha: string
  name: string
  links: {
    blob: string
  }
}
export type TreeEntry = TreeEntryTree | TreeEntryBlob

export type ErrorStatusCode = number
export type APIResult = APIIndex | RepoIndex | Repo | Tree | Buffer | ErrorStatusCode

export interface APIErrorResponse {
  success: false
  error: string
}
export interface APISuccessResponse {
  success: true
  result: APIResult
}
export type APIResponse = APIErrorResponse | APISuccessResponse

class API {
  baseRepoPath: string

  constructor(private req:APIRequest) {
    this.baseRepoPath = path.resolve(path.join(__dirname, "../repos"))
  }

  repos(callback: (error:string|null, repos?:RepoIndex|ErrorStatusCode) => void) {
    fs.readdir(this.baseRepoPath, (error, files) => {
      if (error) {
        callback(error.toString())
      }
      else {
        callback(null, {
          repos: files.map<Repo>(this.getRepoFromFilename.bind(this)),
          links: {
            self: this.req.apiUrl("/repos"),
            parent: this.req.apiUrl("/")
          }
        })
      }
    })
  }

  repo(slug: string, callback: (error:string|null, repo?:Repo|ErrorStatusCode) => void) {
    this.validateRepoFolder(slug, (repoFolder) => {
      if (repoFolder.type === "invalid") {
        callback(repoFolder.error, repoFolder.code)
      }
      else {
        callback(null, this.getRepoFromFilename(repoFolder.folder))
      }
    })
  }

  tree(slug: string, tree: string|null, callback:(error:string|null, tree?:Tree|ErrorStatusCode) => void) {
    this.validateRepoFolder(slug, (repoFolder) => {
      if (repoFolder.type === "invalid") {
        callback(repoFolder.error, repoFolder.code)
      }
      else {
        const git = new Git(repoFolder.path)
        tree = tree || "master"

        git.result(["ls-tree", tree], (error, output) => {
          if (error) {
            callback(error)
          }
          else {
            const lines = (output || "").replace(/\r/g, "").split("\n").filter(line => line.length > 0)
            const entries = lines.map<TreeEntry>((line) => {
              const [info, name] = line.split("\t")
              const [mode, type, sha] = info.split(" ")
              const link = this.req.apiUrl(`/repos/${slug}/${type}/${sha}`)

              if (type === "blob") {
                return {
                  type: "blob",
                  mode: mode,
                  sha: sha,
                  name: name,
                  links: {blob: link}
                }
              }
              else {
                return {
                  type: "tree",
                  mode: mode,
                  sha: sha,
                  name: name,
                  links: {tree: link}
                }
              }
            })

            callback(null, {
              entries: entries,
              links: {
                self: this.req.apiUrl(`/repos/${slug}/tree/${tree}`)
              }
            })
          }
        })
      }
    })
  }

  blob(slug: string, blob: string, callback:(error:string|null, blob?:Buffer|ErrorStatusCode) => void) {
    this.validateRepoFolder(slug, (repoFolder) => {
      if (repoFolder.type === "invalid") {
        callback(repoFolder.error, repoFolder.code)
      }
      else {
        const git = new Git(repoFolder.path)
        git.rawResult(["show", blob], callback)
      }
    })
  }

  private getRepoFromFilename(filename:string):Repo {
    const slug = path.basename(filename, ".git")
    return {
      name: `${slug.substr(0, 1).toUpperCase()}${slug.substr(1)}`,
      slug: slug,
      links: {
        tree: this.req.apiUrl(`/repos/${slug}/tree`),
        self: this.req.apiUrl(`/repos/${slug}`),
        parent: this.req.apiUrl("/repos")
      }
    }
  }

  private validateRepoFolder(slug:string, callback:(repoFolder:RepoFolder) => void) {
    const repoFolder = `${path.basename(slug)}.git`
    const repoPath = path.join(this.baseRepoPath, repoFolder)

    fs.stat(repoPath, (error, stats) => {
      if (error) {
        if (error.code === "ENOENT") {
          callback({
            type: "invalid",
            error: `Unknown repo: ${slug}`,
            code: 404
          })
        }
        else {
          callback({
            type: "invalid",
            error: error.toString(),
            code: 500
          })
        }
      }
      else {
        callback({
          type: "valid",
          folder: repoFolder,
          path: repoPath
        })
      }
    })
  }
}

// GIT INTERFACE

class Git {
  private binary:string
  private spawnOptions:any

  constructor(private gitPath:string) {
    this.binary = "git"
    this.spawnOptions = {cwd: this.gitPath}
  }

  result(args:Array<string>, callback: (error:string|null, output?:string) => void) {
    const rawData = Array<string>()
    const rawDecoder = new StringDecoder("utf8")
    const stream = spawn(this.binary, args, this.spawnOptions)

    stream.stdout.on("data", (data:Buffer) => {
      rawData.push(rawDecoder.write(data))
    })

    stream.stderr.on("data", (error) => {
      callback(error.toString());
    })

    stream.on("close", () => {
      rawData.push(rawDecoder.end())
      callback(null, rawData.join(""))
    });
  }

  rawResult(args:Array<string>, callback: (error:string|null, output?:Buffer) => void) {
    const rawData = Array<Buffer>()
    const stream = spawn(this.binary, args, this.spawnOptions)

    stream.stdout.on("data", (data:Buffer) => {
      rawData.push(data)
    })

    stream.stderr.on("data", (error) => {
      callback(error.toString());
    })

    stream.on("close", () => {
      callback(null, Buffer.concat(rawData))
    });
  }
}

// SERVER CREATION
const app = express()
const port = process.env.PORT || 3000
let api:API

// MIDDLEWARE

interface APIRequest extends express.Request {
  apiUrl(endPoint:string, query?:any): string
}

interface APIResponse extends express.Response {
  api(error:string|null, result?: APIResult): express.Response
}

app.use((req:APIRequest, res:APIResponse, next:express.NextFunction) => {
  api = new API(req)

  req.apiUrl = (endPoint:string) => {
    return url.format({
      protocol: req.protocol,
      hostname: req.hostname,
      port: port,
      pathname: `/api${endPoint}`
    })
  }

  res.api = (error, result) => {
    res.setHeader("Content-Type", "application/json")
    if (error || !result) {
      res.statusCode = typeof result === "number" ? result : 500
      return res.json({success: false, error: error || "Undefined result"} as APIErrorResponse)
    }
    return res.json({success: true, result: result} as APISuccessResponse)
  }
  next()
})

// ROUTES

app.use(express.static(path.join(__dirname, "../")))

app.get("/api", (req:APIRequest, res:APIResponse) => {
  res.api(null, {
    links: {
      self: req.apiUrl("/"),
      repos: req.apiUrl("/repos")
    }
  })
})

app.get("/api/repos", (req:APIRequest, res:APIResponse) => {
  api.repos(res.api)
})

app.get("/api/repos/:slug", (req:APIRequest, res:APIResponse) => {
  api.repo(req.params.slug, res.api)
})

app.get("/api/repos/:slug/tree", (req:APIRequest, res:APIResponse) => {
  api.tree(req.params.slug, null, res.api)
})

app.get("/api/repos/:slug/tree/:tree", (req:APIRequest, res:APIResponse) => {
  api.tree(req.params.slug, req.params.tree, res.api)
})

app.get("/api/repos/:slug/blob/:blob", (req:APIRequest, res:APIResponse) => {
  api.blob(req.params.slug, req.params.blob, (error, result) => {
    if (error) {
      res.api(error, result)
    }
    else {
      res.setHeader("Content-Type", "text/plain")
      res.send(result)
    }
  })
})

// SERVER STARTUP

app.listen(port, () => {
  console.log(`Started server on port ${port}`)
})

