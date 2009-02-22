require 'rake'
require 'pathname'

ROOT    = Pathname.new(__FILE__).dirname.realpath
PUBLIC  = ROOT.join('public')
CONTENT = ROOT.join('content')

desc 'Remove generated files'
task :clobber do
  PUBLIC.rmtree if PUBLIC.exist?
end

namespace :build do
  task :create_public => :clobber do
    PUBLIC.mkpath
  end
  
  task :haml do
    Pathname.glob(CONTENT.join('**/*.haml').to_s) do |haml|
      file = PUBLIC + haml.relative_path_from(CONTENT).sub_ext('')
      file.dirname.mkpath
      sh "haml --style ugly #{haml} #{file}"
    end
  end
  
  task :sass do
    Pathname.glob(CONTENT.join('**/*.sass').to_s) do |sass|
      css = PUBLIC + sass.relative_path_from(CONTENT).sub_ext('.css')
      css.dirname.mkpath
      sh "sass --style compressed #{sass} #{css}"
    end
  end
  
  task :copy do
    Pathname.glob(CONTENT.join('**/*').to_s, File::FNM_DOTMATCH) do |from|
      next if from.directory?
      next if '.sass' == from.extname or '.haml' == from.extname
      to = PUBLIC + from.relative_path_from(CONTENT)
      to.dirname.mkpath
      to.make_link(from)
    end
  end
end
