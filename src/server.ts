// server.ts
import * as express from "express"
import * as path from "path"
import * as fs from "fs"
import * as url from "url"

// API
interface APIIndex {
  links: {
    self: string
    repos: string
  }
}
interface RepoIndex {
  repos: Repo[]
  links: {
    self: string
    parent: string
  }
}
interface Repo {
  name: string
  slug: string
  links: {
    self: string
    parent: string
  }
}
type ErrorStatusCode = number
type APIResult = APIIndex | RepoIndex | Repo | ErrorStatusCode

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
    const repoFolder = `${path.basename(slug)}.git`
    const repoPath = path.join(this.baseRepoPath, repoFolder)

    fs.stat(repoPath, (error, stats) => {
      if (error) {
        if (error.code === "ENOENT") {
          callback(`Unknown repo: ${slug}`, 404)
        }
        else {
          callback(error.toString())
        }
      }
      else {
        callback(null, this.getRepoFromFilename(repoFolder))
      }
    })
  }

  private getRepoFromFilename(filename:string):Repo {
    const slug = path.basename(filename, ".git")
    return {
      name: `${slug.substr(0, 1).toUpperCase()}${slug.substr(1)}`,
      slug: slug,
      links: {
        self: this.req.apiUrl(`/repos/${slug}`),
        parent: this.req.apiUrl("/repos")
      }
    }
  }
}

// SERVER CREATION
const app = express()
const port = process.env.PORT || 3000
let api:API

// MIDDLEWARE

interface APIRequest extends express.Request {
  apiUrl(endPoint:string): string
}

interface APIResponse extends express.Response {
  api(error:string|null, result?: APIResult): express.Response
}

app.use((req:APIRequest, res:APIResponse, next:express.NextFunction) => {
  api = new API(req)

  req.apiUrl = (endPoint) => {
    return url.format({
      protocol: req.protocol,
      hostname: req.hostname,
      port: port,
      pathname: `/api${endPoint}`
    })
  }

  res.api = (error, result) => {
    res.setHeader("Content-Type", "application/json")
    if (error) {
      res.statusCode = typeof result === "number" ? result : 500
      return res.json({success: false, error: error})
    }
    return res.json({success: true, result: result})
  }
  next()
})

// ROUTES

app.get("/", (req:express.Request, res:express.Response) => {
  res.send("Hello world!")
})

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

// SERVER STARTUP

app.listen(port, () => {
  console.log(`Started server on port ${port}`)
})

